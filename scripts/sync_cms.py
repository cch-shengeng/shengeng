#!/usr/bin/env python3
"""
自動同步醫院部門網頁系統 → cms.json
--------------------------------------------------
讀取彰基部門網頁「計畫成果分享」「工作討論議錄」的文章列表，
整理成 cms.json，讓 GitHub 網頁自動顯示最新文章。

由 .github/workflows/sync-cms.yml 每天自動執行，不需要手動操作。
只用 Python 內建模組，不需要安裝任何套件。

醫院網頁改版時，通常只需要調整下方「設定」區。
"""
import html
import threading
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

# ===================== 設定 =====================
BASE = os.environ.get('CMS_BASE', 'https://dpt.cch.org.tw/layout/layout_1/')
SITE_ID = '91192'
SECTIONS = {               # 輸出名稱: 醫院系統的分類 cID
    'results': '610',      # 計畫成果分享
    'minutes': '611',      # 工作討論議錄
}
GET_IMAGE = {'results'}    # 這些分類會進入文章抓第一張照片
MAX_PAGES = 20             # 每個分類最多讀幾頁列表
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cms.json')
TIME_BUDGET = int(os.environ.get('SYNC_TIME_BUDGET', 8 * 60))       # 總執行時間上限（秒），超過就先存已抓到的，其餘下次再抓
REQUEST_LIMIT = int(os.environ.get('SYNC_REQUEST_LIMIT', 45))        # 單一網頁最多等幾秒
KEEPALIVE_DAYS = 30        # 內容沒變時，每隔幾天仍更新一次時間戳，避免 GitHub 停用排程
# ================================================

TW = timezone(timedelta(hours=8))
START = time.monotonic()
try:  # 讓 GitHub 的執行紀錄即時顯示進度
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except AttributeError:
    pass


def over_budget():
    return time.monotonic() - START > TIME_BUDGET
UA = 'Mozilla/5.0 (compatible; CCH-Shengeng-Sync/1.0; +https://github.com)'


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9'})
    with urllib.request.urlopen(req, timeout=20) as r:
        cs = r.headers.get_content_charset() or 'utf-8'
        chunks, t0 = [], time.monotonic()
        while True:
            b = r.read(65536)
            if not b:
                break
            chunks.append(b)
            if time.monotonic() - t0 > REQUEST_LIMIT:
                raise TimeoutError('下載太慢')
    raw = b''.join(chunks)
    try:
        return raw.decode(cs)
    except (LookupError, UnicodeDecodeError):
        return raw.decode('utf-8', errors='replace')


def fetch(url, tries=3):
    """讀取網頁；每次最多等 REQUEST_LIMIT 秒（連 DNS 卡住也算），失敗會重試。"""
    for i in range(tries):
        box = {}

        def work():
            try:
                box['ok'] = _get(url)
            except Exception as e:  # noqa: BLE001
                box['err'] = e
        t0 = time.monotonic()
        th = threading.Thread(target=work, daemon=True)
        th.start()
        th.join(REQUEST_LIMIT + 5)
        took = time.monotonic() - t0
        if 'ok' in box:
            print(f'    ✓ {took:.1f} 秒　{url}')
            return box['ok']
        err = box.get('err', f'超過 {REQUEST_LIMIT} 秒沒有回應')
        print(f'  ! 讀取失敗（第 {i + 1} 次，{took:.0f} 秒）{url}：{err}', file=sys.stderr)
        if over_budget():
            break
        time.sleep(3 * (i + 1))
    raise RuntimeError(f'無法讀取 {url}')


def text_parts(fragment):
    """把一段 HTML 拆成一段段純文字。"""
    fragment = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', fragment)
    fragment = re.sub(r'(?i)<br\s*/?>|</(p|div|h\d|li|span|td|dt|dd)>', '\n', fragment)
    fragment = re.sub(r'<[^>]+>', ' ', fragment)
    fragment = html.unescape(fragment).replace('　', '　')
    parts = [re.sub(r'[ \t\r\f\v]+', ' ', p).strip() for p in fragment.split('\n')]
    return [p for p in parts if p]


DATE_RE = re.compile(r'(20\d{2})[./-](\d{1,2})[./-](\d{1,2})')


def parse_list(page_html, cid):
    """從列表頁找出所有文章：Key、標題、日期、摘要。"""
    items = {}
    pat = re.compile(r'(?is)<a\b[^>]*href\s*=\s*["\']([^"\']*item_detail\.aspx\?[^"\']*)["\'][^>]*>(.*?)</a>')
    for mm in pat.finditer(page_html):
        href, inner = mm.group(1), mm.group(2)
        href_u = html.unescape(href)
        if not re.search(r'[?&]cID=' + cid + r'(?:&|$)', href_u):
            continue
        m = re.search(r'[?&]Key=(\d+)', href_u)
        if not m:
            continue
        key = m.group(1)
        joined = ' '.join(text_parts(inner))
        d = DATE_RE.search(joined)
        title, summary, date = joined, '', ''
        if not d:  # 日期不在連結裡時，往後找一小段
            near = DATE_RE.search(' '.join(text_parts(page_html[mm.end():mm.end() + 400])))
            if near:
                date = f'{near.group(1)}/{int(near.group(2)):02d}/{int(near.group(3)):02d}'
        if d:
            date = f'{d.group(1)}/{int(d.group(2)):02d}/{int(d.group(3)):02d}'
            title = joined[:d.start()].strip()
            summary = joined[d.end():].strip()
        title = re.sub(r'\s+', ' ', title).strip(' -｜|')
        if not title:
            continue
        if summary and (summary == title or title.startswith(summary) or summary.startswith(title)):
            summary = ''
        if len(summary) > 90:
            summary = summary[:88].rstrip() + '…'
        url = urljoin(BASE, href_u)
        old = items.get(key)
        # 同一篇可能出現多個連結（圖示、標題），保留資訊最完整的那個
        if not old or (date and not old['日期']) or len(title) > len(old['標題']):
            items[key] = {'key': key, '日期': date, '標題': title, '摘要': summary, '文章連結': url}
    return items


IMG_RE = re.compile(r'(?i)(?:src|href)\s*=\s*["\']([^"\']*/upload/site_item/[^"\']+?\.(?:jpe?g|png|gif|webp))["\']')


def first_image(article_url):
    page = fetch(article_url)
    m = IMG_RE.search(page)
    return urljoin(article_url, html.unescape(m.group(1))) if m else ''


def crawl(section, cid, cache):
    found, order = {}, []
    for p in range(1, MAX_PAGES + 1):
        url = f'{BASE}item.aspx?cID={cid}&ID={SITE_ID}' + (f'&p={p}' if p > 1 else '')
        try:
            items = parse_list(fetch(url), cid)
        except RuntimeError as e:
            if p == 1:
                raise
            print(f'  ! 第 {p} 頁讀取失敗，先用已讀到的：{e}', file=sys.stderr)
            break
        new = [k for k in items if k not in found]
        print(f'  {section} 第 {p} 頁：{len(items)} 篇，新的 {len(new)} 篇')
        if not new:
            break
        for k in new:
            found[k] = items[k]
            order.append(k)
        time.sleep(1)

    out = []
    for k in order:
        it = found[k]
        old = cache.get(k, {})
        if section in GET_IMAGE:
            if old.get('_checked'):
                it['圖片連結'] = old.get('圖片連結', '')
            elif over_budget():
                it['圖片連結'] = old.get('圖片連結', '')  # 時間不夠，照片下次再抓
                out.append(it)
                continue
            else:
                try:
                    it['圖片連結'] = first_image(it['文章連結'])
                    print(f'    抓照片 Key={k}：{"有" if it["圖片連結"] else "無"}')
                except RuntimeError:
                    it['圖片連結'] = old.get('圖片連結', '')
                time.sleep(1)
            it['_checked'] = True
        if not it['日期'] and old.get('日期'):
            it['日期'] = old['日期']
        out.append(it)
    out.sort(key=lambda x: x.get('日期', ''), reverse=True)
    return out


def main():
    print(f'開始同步：{BASE}（單頁上限 {REQUEST_LIMIT} 秒，總時間上限 {TIME_BUDGET // 60} 分鐘）')
    try:
        with open(OUT, encoding='utf-8') as f:
            prev = json.load(f)
    except (OSError, ValueError):
        prev = {}

    data = {}
    for section, cid in SECTIONS.items():
        print(f'讀取 {section}（cID={cid}）')
        cache = {x.get('key'): x for x in prev.get(section, []) if x.get('key')}
        try:
            rows = crawl(section, cid, cache)
        except RuntimeError as e:
            print(f'✗ 連不到醫院網頁：{e}\n  可能是醫院網站擋了 GitHub 的海外主機，或網站暫時沒有回應。網站會繼續顯示上次的資料。', file=sys.stderr)
            sys.exit(1)
        if not rows:
            # 一篇都抓不到 → 多半是醫院網頁改版或暫時連不上，保留舊資料並回報失敗
            print(f'✗ {section} 一篇文章都沒抓到，保留舊資料。請檢查醫院網頁是否改版。', file=sys.stderr)
            sys.exit(1)
        data[section] = rows

    now = datetime.now(TW)
    same = all(prev.get(s) == data[s] for s in SECTIONS)
    last = prev.get('updated', '')
    stale = True
    try:
        stale = now - datetime.fromisoformat(last) > timedelta(days=KEEPALIVE_DAYS)
    except ValueError:
        pass
    if same and not stale:
        print('內容沒有變化，不更新檔案。')
        return
    data = {'updated': now.isoformat(timespec='seconds'),
            'source': f'{BASE}index.aspx?ID={SITE_ID}', **data}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'✓ 已更新 cms.json：成果 {len(data["results"])} 篇、議錄 {len(data["minutes"])} 篇')


if __name__ == '__main__':
    main()
