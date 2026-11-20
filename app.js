/* 彰基教學部深耕計畫專區 —— 資料讀取與畫面產生
   資料來源：SITE_CONFIG.sheetId 有填 → 讀 Google 試算表；沒填或讀取失敗 → 用 data.js 內建資料。 */
{
const CFG = window.SITE_CONFIG || {tabs:{},cms:{}};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = s => { s = String(s || '').trim(); return /^https?:\/\//i.test(s) ? encodeURI(decodeURI(s)) : ''; };
const yes = v => /^(true|是|v|✔|✓|y|yes|1)$/i.test(String(v ?? '').trim());
const shown = r => !/^(false|否|n|no|0)$/i.test(String(r['刊登'] ?? '').trim());
const WEEK = '日一二三四五六';

/* 2026/11/04、2026-11-04、115/11/04 都可以 */
function parseDate(s){
  const m = String(s || '').trim().match(/^(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return null;
  let y = +m[1]; if (y < 1911) y += 1911;
  return new Date(y, m[2] - 1, +m[3]);
}
const fmt = d => d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}` : '';
const today = (() => { const t = new Date(); t.setHours(0,0,0,0); return t; })();

/* ---------- CSV ---------- */
function parseCSV(text){
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ','){ row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(head.map((h,i) => [h, (r[i] ?? '').trim()])));
}

async function loadData(){
  const def = window.DEFAULT_DATA || {};
  const t = CFG.tabs || {};
  if (!CFG.sheetId) return {data: def, src: '內建範例資料（尚未連接 Google 試算表）'};
  const get = async name => {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(name);
    return parseCSV(await r.text());
  };
  try {
    const keys = ['news','courses','results','minutes','resources'];
    const vals = await Promise.all(keys.map(k => get(t[k])));
    const data = {}; keys.forEach((k,i) => data[t[k]] = vals[i]);
    const now = new Date();
    return {data, src: `資料來源：Google 試算表（讀取於 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}）`};
  } catch(e){
    console.warn('Google 試算表讀取失敗，改用內建資料', e);
    return {data: def, src: '無法讀取 Google 試算表，暫時顯示內建資料'};
  }
}

/* ---------- 課程狀態 ---------- */
function courseInfo(c){
  const d = parseDate(c['日期']), dl = parseDate(c['報名截止']);
  const how = c['報名方式'] || '';
  let st, label;
  if (!d || d < today){ st = 'past'; label = '已結束'; }
  else if (/待公告/.test(how) || (!url(c['報名連結']) && /表單/.test(how))){ st = 'tba'; label = '報名待公告'; }
  else if (dl && dl < today){ st = 'closed'; label = '報名已截止'; }
  else if (dl && (dl - today) / 864e5 <= 7){ st = 'soon'; label = '即將截止'; }
  else { st = 'open'; label = '報名中'; }
  return {d, dl, st, label};
}
function gcal(c, d){
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const hm = s => (s || '').replace(':','') + '00';
  const dates = c['開始'] ? `${ymd}T${hm(c['開始'])}/${ymd}T${hm(c['結束'] || c['開始'])}` : `${ymd}/${ymd}`;
  const p = new URLSearchParams({action:'TEMPLATE', text:c['課程名稱'], dates, ctz:'Asia/Taipei', location:c['地點'] || '', details:'彰基教學部深耕計畫'});
  return 'https://calendar.google.com/calendar/render?' + p;
}

/* ---------- 畫面 ---------- */
function render({data, src}){
  const T = CFG.tabs, cms = CFG.cms || {};
  const news = (data[T.news] || []).filter(shown);
  const courses = (data[T.courses] || []).filter(shown).map(c => ({...c, ...courseInfo(c)}));
  const results = (data[T.results] || []).filter(shown).sort((a,b) => (parseDate(b['日期'])||0) - (parseDate(a['日期'])||0));
  const minutes = (data[T.minutes] || []).filter(shown);
  const res = (data[T.resources] || []).filter(shown);

  // 原系統連結
  [['#resultsMore',cms.results],['#coursesMore',cms.courses],['#minutesMore',cms.minutes],['#contactLink',cms.contacts],['#lnkContacts',cms.contacts],['#lnkExperts',cms.experts]]
    .forEach(([s,h]) => { const a = $(s); if (a && h) a.href = h; });

  // 跑馬燈
  const tick = news.map(n => {
    const inner = `<time>${esc(fmt(parseDate(n['日期'])))}</time>${esc(n['內容'])}`;
    return url(n['連結']) ? `<a href="${url(n['連結'])}">${inner}</a>` : `<span>${inner}</span>`;
  }).join('');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#ticker').innerHTML = tick + (reduce ? '' : `<span aria-hidden="true" style="display:contents">${tick}</span>`);

  // 下一堂課卡片
  const upcoming = courses.filter(c => c.st !== 'past').sort((a,b) => a.d - b.d);
  const nx = upcoming[0];
  $('#nextCard').innerHTML = nx
    ? `<span class="tag">下一堂課</span><div class="d">${nx.d.getMonth()+1}/${nx.d.getDate()}<small style="font-size:16px"> 週${WEEK[nx.d.getDay()]}</small></div>
       <p class="t">${esc(nx['課程名稱'])}</p><a href="#courses">看課程資訊 →</a>`
    : `<span class="tag">課程預告</span><p class="t" style="margin-top:8px">新一季課程整理中，敬請期待。</p><a href="#courses">看往期課程 →</a>`;

  // 數字
  const y = today.getFullYear();
  const stat = [
    ['本年度課程活動', courses.filter(c => c.d && c.d.getFullYear() === y).length, '場'],
    ['即將開課', upcoming.length, '場'],
    ['計畫成果分享', results.length, '篇'],
    ['合作醫院', 3, '家']
  ];
  $('#stats').innerHTML = stat.map(([k,v,u]) => `<div><dt>${k}</dt><dd>${v}<small>${u}</small></dd></div>`).join('');

  // 成果亮點：精選打勾者，最多 3 則
  let feats = results.filter(r => yes(r['精選'])).slice(0,3);
  if (!feats.length) feats = results.slice(0,3);
  const fb = ['', ' alt', ' alt2'];
  $('#features').innerHTML = feats.map((r,i) => {
    const img = url(r['圖片連結']);
    const ph = img ? `<div class="ph"><img src="${img}" alt="" loading="lazy" onerror="this.parentNode.classList.add('fallback'${fb[i] ? `,'${fb[i].trim()}'` : ''});this.remove()"></div>`
                   : `<div class="ph fallback${fb[i]}"></div>`;
    return `<a class="feature" href="${url(r['文章連結']) || '#records'}">${ph}<div class="body"><time>${esc(fmt(parseDate(r['日期'])))}</time>
      <h3>${esc(r['標題'])}</h3>${r['摘要'] ? `<p>${esc(r['摘要'])}</p>` : ''}</div></a>`;
  }).join('');

  // 課程篩選
  const types = [...new Set(courses.map(c => c['類別']).filter(Boolean))];
  $('#fType').innerHTML = ['全部類別', ...types].map((t,i) => `<button type="button" data-v="${i ? esc(t) : ''}" aria-pressed="${!i}">${esc(t)}</button>`).join('');
  const f = {status: upcoming.length >= 2 ? 'upcoming' : 'all', type: '', q: ''};
  $('#fStatus').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === f.status));

  const drawCourses = () => {
    let list = courses.filter(c =>
      (f.status === 'all' || (f.status === 'past' ? c.st === 'past' : c.st !== 'past')) &&
      (!f.type || c['類別'] === f.type) &&
      (!f.q || Object.values(c).join(' ').toLowerCase().includes(f.q)));
    const fut = (a,b) => (a.st === 'past') - (b.st === 'past') || (a.st === 'past' ? (b.d || 0) - (a.d || 0) : (a.d || 0) - (b.d || 0));
    list.sort(fut);
    $('#courseList').innerHTML = list.length ? list.map(c => {
      const d = c.d;
      const meta = [['時間', c['開始'] ? `${c['開始']}–${c['結束']}` : '另行公告'], ['地點', c['地點']], ['對象', c['適用對象']],
        ['名額', c['名額']], ['報名', c['報名方式']], ['截止', c.dl ? fmt(c.dl) : ''], ['講師', c['講師']], ['備註', c['備註']]]
        .filter(([,v]) => v).map(([k,v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
      const reg = url(c['報名連結']);
      let main = '';
      if (c.st === 'open' || c.st === 'soon') main = reg ? `<a class="btn btn-green" href="${reg}">立即報名</a>` : `<a class="btn btn-line" href="${url(CFG.cms.contacts)}">洽合作醫院窗口</a>`;
      const links = [
        url(c['海報連結']) && `<a class="lnk" href="${url(c['海報連結'])}">活動海報</a>`,
        url(c['簡章連結']) && `<a class="lnk" href="${url(c['簡章連結'])}">下載簡章</a>`,
        c.st !== 'past' && d && `<a class="lnk" href="${gcal(c,d)}">加入 Google 行事曆</a>`
      ].filter(Boolean).join('');
      return `<li class="course ${c.st === 'past' ? 'past' : ''}">
        <div class="cdate">${d ? `<div class="m">${d.getFullYear()}<br><b>${d.getMonth()+1} 月</b></div><div class="dd">${d.getDate()}</div><div class="w">週${WEEK[d.getDay()]}</div>` : '<div class="m">日期未定</div>'}</div>
        <div class="cmain"><div class="badges"><span class="badge st-${c.st}">${c.label}</span>${c['類別'] ? `<span class="badge">${esc(c['類別'])}</span>` : ''}${c['授課方式'] ? `<span class="badge">${esc(c['授課方式'])}</span>` : ''}</div>
          <h3>${esc(c['課程名稱'])}</h3><dl class="meta">${meta}</dl></div>
        <div class="cact">${main}${links}</div></li>`;
    }).join('') : `<li class="empty">${f.status === 'upcoming' ? '目前沒有即將開課的課程，新一季課程整理中。' : '找不到符合條件的課程。'}</li>`;
  };
  $('#fStatus').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.status = b.dataset.v;
    $('#fStatus').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawCourses(); };
  $('#fType').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.type = b.dataset.v;
    $('#fType').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawCourses(); };
  $('#fSearch').oninput = e => { f.q = e.target.value.trim().toLowerCase(); drawCourses(); };
  drawCourses();

  // 成果列表＋議錄
  const SHOW = 6;
  $('#resultList').innerHTML = results.map((r,i) => `<li class="${i >= SHOW ? 'hide' : ''}"><a href="${url(r['文章連結']) || '#'}"><time>${esc(fmt(parseDate(r['日期'])))}</time><strong>${esc(r['標題'])}</strong></a></li>`).join('');
  const tg = $('#resultToggle');
  if (results.length <= SHOW) tg.remove();
  else tg.onclick = () => { const open = tg.dataset.open !== '1'; tg.dataset.open = open ? '1' : '';
    $('#resultList').querySelectorAll('li').forEach((li,i) => li.classList.toggle('hide', !open && i >= SHOW)); tg.textContent = open ? '收合' : '顯示更多'; };
  $('#minuteList').innerHTML = minutes.map(m => `<li><a href="${url(m['連結']) || '#'}"><time>${esc(fmt(parseDate(m['日期'])))}</time><strong>${esc(m['標題'])}</strong></a></li>`).join('');

  // 資源
  const groups = [...new Set(res.map(r => r['分類']))];
  $('#resGroups').innerHTML = groups.map(g => {
    const items = res.filter(r => r['分類'] === g);
    const mini = items.every(r => !r['說明']);
    return `<div class="res-group"><h3>${esc(g)}</h3><div class="res-grid">${items.map(r =>
      `<a class="res${mini ? ' mini' : ''}" href="${url(r['連結']) || '#'}"><strong>${esc(r['標題'])}</strong>${r['說明'] ? `<span>${esc(r['說明'])}</span>` : ''}</a>`).join('')}</div></div>`;
  }).join('');

  $('#dataSrc').textContent = src;
}

loadData().then(render);
}
