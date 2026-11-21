/* Shared prototype runtime: language, device preview, hash routing, block renderers, popovers. */
const S = { lang: 'ar', device: 'desktop', sub: {}, last: {} };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const T = (s) => { if (s == null) return ''; s = String(s); const i = s.indexOf('|'); return i < 0 ? s : S.lang === 'ar' ? s.slice(i + 1) : s.slice(0, i); };
const E = (s) => esc(T(s));

const ICONS = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .8 3.5 2.8 3.5 5.6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6L6 18',
  chev: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 3l8 3v6c0 4.5-3.3 8-8 9-4.7-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  building: 'M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3',
  phone: 'M8 2h8v20H8zM11 18h2',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M9 12h10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  side: 'M4 5h16v14H4zM9 5v14',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  id: 'M3 6h18v12H3zM14 10h4M14 14h4M8.5 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5.5 15.5c.6-2 5.4-2 6 0',
  back: 'M15 6l-6 6 6 6',
};
const FLIP = { chev: 1, logout: 1, side: 1, back: 1 };
const I = (n, cls = '') => `<svg class="i ${FLIP[n] ? 'flip' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n] || ICONS.grid}"/></svg>`;
const PICON = { home: 'home', visit: 'receipt', day: 'calendar', pkgsale: 'tag', services: 'tag', categories: 'grid', packages: 'doc', employees: 'users', numbers: 'id', import: 'upload', doctypes: 'doc', schedules: 'calendar', 'schedule-rules': 'gear', 'att-board': 'clock', 'att-exceptions': 'alert', 'att-requests': 'inbox', 'att-report': 'chart', 'att-statement': 'doc', 'leave-approvals': 'inbox', 'leave-history': 'chart', identity: 'building', permissions: 'shield', alerts: 'bell', applink: 'phone', appcols: 'grid', security: 'shield' };
const COUNTS = { 'leave-approvals': 3, 'att-requests': 2, 'att-exceptions': 4 };
const cnt = (ids) => ids.reduce((n, id) => n + (COUNTS[id] || 0), 0);
const badgeN = (n) => (n ? `<span class="count num">${n}</span>` : '');

/* ---------- cells, buttons ---------- */
const btn = (a, sm) => `<button type="button" class="btn ${sm ? 'sm ' : ''}${a.v === 'primary' || (!a.v && !sm) ? '' : a.v || 'outline'}" ${a.go ? `data-go="${a.go}"` : 'data-toast'}>${E(a.a)}</button>`;
function cell(c) {
  if (Array.isArray(c)) return c.map(cell).join(' ');
  if (c && typeof c === 'object') {
    if (c.b) return `<span class="badge ${c.b}">${E(c.t)}</span>`;
    if (c.a) return btn(c, true);
    if (c.n != null) return `<span class="num">${esc(c.n)}</span>`;
  }
  return E(c);
}
function control([label, type, val, , hint], i, pid) {
  const id = `f-${pid}-${i}`;
  const l = E(label);
  if (type === 'check') return `<label class="check"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}> ${l}</label>`;
  if (type === 'button') return `<div class="field" style="justify-content:flex-end"><button type="button" class="btn outline" data-toast>${E(val)}</button></div>`;
  let c;
  if (type === 'select') c = `<select class="input" id="${id}">${val.map((o) => `<option>${E(o)}</option>`).join('')}</select>`;
  else if (type === 'textarea') c = `<textarea class="input" id="${id}">${E(val)}</textarea>`;
  else c = `<input class="input ${type === 'num' ? 'num' : ''}" id="${id}" type="${{ date: 'date', time: 'time', month: 'month' }[type] || 'text'}" ${type === 'num' ? 'inputmode="decimal"' : ''} value="${E(val)}">`;
  return `<div class="field"><label for="${id}">${l}</label>${c}${hint ? `<small>${E(hint)}</small>` : ''}</div>`;
}
const spanCls = (s) => (s === 12 ? 's12' : s === 4 || s === 3 ? 's4' : '');
const wrapSpan = (html, s) => (spanCls(s) ? html.replace(/class="(field|check)"/, `class="$1 ${spanCls(s)}"`) : html);

/* ---------- blocks ---------- */
let BID = 0;
const BLOCK = {
  stats: (rows) => `<div class="stats">${rows.map(([l, v, d, tone]) => `<div class="card stat ${tone || ''}"><span class="l">${E(l)}</span><span class="v">${/^[\d\-—+−:.\s]+$/.test(T(v)) ? `<span class="num">${E(v)}</span>` : E(v)}</span>${d ? `<span class="d">${E(d)}</span>` : ''}</div>`).join('')}</div>`,
  table(t, pid) {
    const fl = (t.filters || []).map(([l, type, v], i) => {
      const id = `q-${pid}-${++BID}-${i}`;
      if (type === 'search') return `<input class="input search" id="${id}" type="search" placeholder="${E(l)}" aria-label="${E(l)}">`;
      if (type === 'select') return `<select class="input" id="${id}" aria-label="${E(l)}">${v.map((o) => `<option>${E(o)}</option>`).join('')}</select>`;
      if (type === 'check') return `<label class="check"><input type="checkbox" id="${id}"> ${E(l)}</label>`;
      return `<input class="input" id="${id}" type="${type}" value="${esc(v || '')}" aria-label="${E(l)}">`;
    }).join('');
    const tg = t.toggle ? `<div class="pills" role="group">${t.toggle.map((o, i) => `<a href="#" data-toast ${i ? '' : 'aria-current="page"'}>${E(o)}</a>`).join('')}</div>` : '';
    return `<div class="card tframe stack">
      ${t.title || t.acts ? `<div class="tbar">${t.title ? `<h2>${E(t.title)}</h2>` : ''}<div class="acts">${(t.acts || []).map((a) => btn(a, true)).join('')}</div></div>` : ''}
      ${fl || tg ? `<div class="filters">${tg}${fl}</div>` : ''}
      <div class="twrap"><table><thead><tr>${t.cols.map((c) => `<th scope="col">${E(c)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td data-l="${E(t.cols[i])}" class="${i ? '' : 'strong'}">${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${t.foot ? `<div class="tfoot"><span>${T('Showing|المعروض')} <span class="num">${t.rows.length}</span></span><div class="acts">${t.foot === 'pager' ? `<button class="btn sm outline" data-toast>${T('First page|الصفحة الأولى')}</button><button class="btn sm outline" data-toast>${T('Next page|الصفحة التالية')}</button>` : `<button class="btn sm outline" data-toast>${T('Load more|تحميل المزيد')}</button>`}</div></div>` : ''}
    </div>`;
  },
  form: (f, pid) => `<div class="card form">${f.sections.map((s, si) => `<div class="fsec"><h2>${E(s.title)}</h2>${s.hint ? `<p>${E(s.hint)}</p>` : ''}${s.fields.map((fd, i) => wrapSpan(control(fd, `${++BID}-${si}-${i}`, pid), fd[3])).join('')}</div>`).join('')}${f.submit ? `<div class="fbar">${f.submit.map((a) => btn(a)).join('')}</div>` : ''}</div>`,
  split: (a, pid, b) => `<div class="split"><div class="col">${blocks(a, pid)}</div><div class="col">${blocks(b, pid)}</div></div>`,
  panel: (p) => `<div class="card panel ${p.sticky ? 'sticky' : ''}">
    ${p.title ? `<h2>${E(p.title)}</h2>` : ''}
    ${p.qr ? `<div class="qr" role="img" aria-label="QR"></div>` : ''}${p.logo ? `<div class="logo-prev">G</div>` : ''}
    ${p.kv ? `<dl class="kv">${p.kv.map(([k, v]) => `<div><dt>${E(k)}</dt><dd>${/^[\d.%]+$/.test(T(v)) ? `<span class="num">${E(v)}</span>` : E(v)}</dd></div>`).join('')}</dl>` : ''}
    ${p.text ? `<p>${E(p.text)}</p>` : ''}
    ${p.list ? `<div class="list">${p.list.map(([t, s, go]) => `<${go ? `a href="#${go}"` : 'div'} class="li">${go ? '' : `<span class="av">${E(t).slice(0, 1)}</span>`}<span class="tx"><b>${E(t)}</b>${/^\d+$/.test(s) ? '' : `<span>${E(s)}</span>`}</span>${/^\d+$/.test(s) ? badgeN(s) : ''}${go ? I('chev') : ''}</${go ? 'a' : 'div'}>`).join('')}</div>` : ''}
    ${p.acts ? `<div class="pacts">${p.acts.map((a) => btn(a)).join('')}</div>` : ''}</div>`,
  steps: (st) => `<ol class="card steps">${st.map(([t, d, a], i) => `<li><span class="sn num">${i + 1}</span><div class="tx"><b>${E(t)}</b><span>${E(d)}</span></div>${a ? btn(a, true) : ''}</li>`).join('')}</ol>`,
  board: (cols) => `<div class="board">${cols.map((c) => `<div class="card bcol"><h2>${E(c.t)} ${badgeN(c.n)}</h2>${c.cards.map(([t, s]) => `<div class="bcard"><b>${E(t)}</b><span>${E(s)}</span></div>`).join('')}</div>`).join('')}</div>`,
  week(w) {
    const days = ['Sat|السبت', 'Sun|الأحد', 'Mon|الاثنين', 'Tue|الثلاثاء', 'Wed|الأربعاء', 'Thu|الخميس', 'Fri|الجمعة'];
    return `<div class="card tframe"><div class="filters"><input class="input" type="date" value="${w.start}" aria-label="${T('Week starts (Saturday)|بداية الأسبوع (السبت)')}"><span class="check">${T('Tap a cell to edit that day.|اضغط الخلية لتعديل اليوم.')}</span></div>
      <div class="twrap"><div class="week"><div class="h n">${T('Employee|الموظف')}</div>${days.map((d, i) => `<div class="h">${E(d)} <span class="num">${21 + i}</span></div>`).join('')}
      ${w.rows.map((r) => `<div class="n">${E(r[0])}</div>${r.slice(1).map((c) => `<div>${c ? `<button class="sh num" data-toast>${c}</button>` : `<span class="off">${T('No shifts|بلا ورديات')}</span>`}</div>`).join('')}`).join('')}</div></div>
      <div class="tfoot"><span>${T('4 employees attached this week|4 موظفات مرتبطات هذا الأسبوع')}</span></div></div>`;
  },
  subtabs(tabs, pid) {
    const cur = S.sub[pid] || 0;
    return `<div class="tabs sub" role="tablist">${tabs.map((t, i) => `<a href="#" role="tab" data-st="${i}" ${i === cur ? 'aria-current="page"' : ''}>${E(t.t)} ${badgeN(t.count)}</a>`).join('')}</div><div class="col subpane">${blocks(tabs[cur].blocks, pid)}</div>`;
  },
  hub: (ids) => `<div class="hub">${ids.map((id) => `<a class="card hubc" href="#${id}"><span class="hi">${I(PICON[id])}</span><span class="tx"><b>${E(PAGES[id].title)} ${badgeN(COUNTS[id])}</b><span>${E(PAGES[id].desc || '')}</span></span>${I('chev')}</a>`).join('')}</div>`,
  note: (t, _p, tone) => `<div class="note ${tone || ''}">${I('alert')}<span>${E(t)}</span></div>`,
};
const blocks = (list, pid) => list.map(([k, a, b]) => BLOCK[k](a, pid, b)).join('');

function pageHTML(id, o = {}) {
  const p = PAGES[id];
  const acts = (p.actions || []).map((a) => btn(a)).join('');
  return `<div class="page ${p.narrow && !o.wide ? 'narrow' : ''}">${o.top || ''}
    <header class="phead"><div class="tx"><h1>${E(p.title)}</h1>${p.desc ? `<p>${E(p.desc)}</p>` : ''}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</header>
    ${o.mid || ''}${blocks(p.blocks, id)}</div>`;
}
const crumbs = (parts) => `<nav class="crumbs" aria-label="breadcrumb">${parts.map(([l, go], i) => (i === parts.length - 1 ? `<b>${E(l)}</b>` : `${go ? `<a href="#${go}">${E(l)}</a>` : `<span>${E(l)}</span>`}${I('chev')}`)).join('')}</nav>`;
const root = (id) => (PAGES[id] && PAGES[id].parent) || id;

/* ---------- shared chrome pieces ---------- */
const WS = { company: 'Lulwa Group|مجموعة لولوة', business: 'Glow Salon|صالون جلو', branch: 'Salmiya|السالمية' };
const brand = (small) => `<a class="brand" href="#home" aria-label="PosPay"><span class="bm">P</span>${small ? '' : '<span class="bw">PosPay</span>'}</a>`;
const wsBtn = (mode) => `<button type="button" class="wsb ${mode || ''}" data-pop="ws" aria-haspopup="dialog">${I('building')}<span class="tx"><b>${E(WS.business)}</b><span>${E(WS.branch)}</span></span>${I('down')}</button>`;
const utils = () => `<button type="button" class="btn ghost icon" data-pop="notif" aria-label="${T('Notifications|الإشعارات')}"><span class="dotw">${I('bell')}<i></i></span></button>
  <button type="button" class="btn outline sm loc" data-lang="${S.lang === 'ar' ? 'en' : 'ar'}">${S.lang === 'ar' ? 'English' : 'العربية'}</button>
  <button type="button" class="avb" data-pop="acct" aria-label="${T('Account|الحساب')}">W</button>`;
const POPS = {
  ws: () => `<h2>${T('Where you are working|أين تعمل الآن')}</h2>
    ${[['Company|الشركة', [WS.company]], ['Business|النشاط', [WS.business, 'Glow Spa|سبا جلو']], ['Branch|الفرع', BRANCHES]].map(([l, o], i) => `<div class="field"><label for="ws${i}">${E(l)}</label><select class="input" id="ws${i}">${o.map((x) => `<option>${E(x)}</option>`).join('')}</select></div>`).join('')}
    <p class="hint">${T('Attendance, leave and alerts pages follow this branch.|صفحات الحضور والإجازات والتنبيهات تتبع هذا الفرع.')}</p>`,
  notif: () => `<h2>${T('Notifications|الإشعارات')}</h2><div class="list">
    <a class="li" href="#leave-approvals"><span class="tx"><b>${T('Sara asked for annual leave|سارة طلبت إجازة سنوية')}</b><span>${T('1–5 December · 8 min ago|1–5 ديسمبر · قبل 8 دقائق')}</span></span></a>
    <a class="li" href="#att-exceptions"><span class="tx"><b>${T('Dalal clocked in 16 minutes late|دلال سجلت دخولًا متأخرًا 16 دقيقة')}</b><span>${T('Salmiya · 09:31|السالمية · 09:31')}</span></span></a>
    <a class="li" href="#employee"><span class="tx"><b>${T('Health card expires in 15 days|البطاقة الصحية تنتهي خلال 15 يومًا')}</b><span>${T('Sara Al-Enezi|سارة العنزي')}</span></span></a></div>
    <button class="btn sm outline" data-toast>${T('Mark all read|تعليم الكل كمقروء')}</button>`,
  acct: () => `<div class="who"><span class="av">W</span><span class="tx"><b>Waleed M.</b><span>owner@glow.example</span></span></div>
    <div class="list"><a class="li" href="#security">${I('shield')}<span class="tx"><b>${T('Authenticator|المصادقة')}</b></span></a></div>
    <div class="seg thm">${[['light', 'Light|فاتح'], ['dark', 'Dark|داكن'], ['', 'System|النظام']].map(([v, l]) => `<button data-theme="${v}" aria-pressed="${(document.documentElement.dataset.theme || '') === v}">${E(l)}</button>`).join('')}</div>
    <button class="btn sm outline" data-toast>${I('logout')}${T('Sign out|تسجيل الخروج')}</button>`,
};
function closePop() { $$('.pop, .scrim.p').forEach((e) => e.remove()); }
function openPop(kind, anchor, html) {
  const app = $('#app'); closePop();
  const r = anchor.getBoundingClientRect(), a = app.getBoundingClientRect();
  const scrim = document.createElement('div'); scrim.className = 'scrim p'; scrim.onclick = closePop;
  const pop = document.createElement('div'); pop.className = `pop card ${kind}`; pop.setAttribute('role', 'dialog');
  pop.innerHTML = html || POPS[kind]();
  pop.style.top = `${Math.min(r.bottom - a.top + 8, a.height - 120)}px`;
  if (r.left + r.width / 2 > a.left + a.width / 2) pop.style.right = `${Math.max(8, a.right - r.right)}px`; else pop.style.left = `${Math.max(8, r.left - a.left)}px`;
  app.append(scrim, pop);
  const f = pop.querySelector('select, a, button, input'); if (f) f.focus({ preventScroll: true });
}
function toast(msg) {
  $$('.toast').forEach((e) => e.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  $('#app').append(t); setTimeout(() => t.remove(), 2200);
}

/* ---------- boot ---------- */
const route = () => { const h = location.hash.slice(1); return PAGES[h] ? h : 'home'; };
function paint(full) {
  const d = document.documentElement; d.lang = S.lang; d.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  $$('.pbar [data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === S.lang));
  $$('.pbar [data-device]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.device === S.device));
  $('.stage').dataset.device = S.device;
  if (full) Shell.mount($('#app'));
  closePop(); Shell.update(route());
  const sc = $('#app .scroll'); if (sc) sc.scrollTop = 0;
}
function boot() {
  try { S.lang = localStorage.getItem('pp-lang') || S.lang; } catch (e) { /* storage may be blocked */ }
  if (window.innerWidth < 700) S.device = 'desktop';
  document.body.insertAdjacentHTML('afterbegin', `<div class="pbar"><b>${Shell.letter}</b><span>${Shell.name}</span><span class="sp"></span>
    <div class="seg dev" role="group" aria-label="Device">${[['desktop', 'Desktop'], ['tablet', 'Tablet'], ['phone', 'Phone']].map(([v, l]) => `<button data-device="${v}">${l}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Language"><button data-lang="ar">العربية</button><button data-lang="en">English</button></div></div>
    <div class="stage"><div class="app" id="app"></div></div>`);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-lang],[data-device],[data-theme],[data-pop],[data-go],[data-st],[data-toast],[data-act]');
    if (!t) return;
    if (t.dataset.lang) { S.lang = t.dataset.lang; try { localStorage.setItem('pp-lang', S.lang); } catch (x) { /* ignore */ } return paint(true); }
    if (t.dataset.device) { S.device = t.dataset.device; return paint(true); }
    if (t.dataset.theme != null && t.closest('.thm')) { const d = document.documentElement; if (t.dataset.theme) d.dataset.theme = t.dataset.theme; else delete d.dataset.theme; return closePop(); }
    if (t.dataset.pop) return openPop(t.dataset.pop, t);
    if (t.dataset.go) { location.hash = t.dataset.go; return; }
    if (t.dataset.st != null) { e.preventDefault(); S.sub[route()] = +t.dataset.st; return Shell.update(route()); }
    if (t.dataset.act) { e.preventDefault(); return Shell.act(t.dataset.act, t); }
    if (t.hasAttribute('data-toast')) { e.preventDefault(); toast(`${T('Prototype only|نموذج فقط')} · ${t.textContent.trim()}`); }
  });
  document.addEventListener('click', (e) => { const l = e.target.closest('a[href^="#"]'); if (l && l.getAttribute('href').slice(1) === location.hash.slice(1)) { closePop(); if (Shell.act) Shell.act('esc'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(); if (Shell.act) Shell.act('esc'); } if (Shell.key) Shell.key(e); });
  window.addEventListener('hashchange', () => paint(false));
  paint(true);
}
