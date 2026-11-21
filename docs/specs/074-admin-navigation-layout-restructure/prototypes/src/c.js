/* Prototype C — four workspaces on an icon rail, a context panel listing the workspace's pages, and a search palette. */
const NAV = [
  { id: 'desk', l: 'Front desk|الاستقبال', i: 'receipt', d: 'Today in the branch: visits, attendance and what needs a decision.|اليوم في الفرع: الزيارات والحضور وما يحتاج قرارًا.', secs: [{ h: 'Now|الآن', ids: ['home', 'visit', 'pkgsale', 'day'] }, { h: 'Attendance today|حضور اليوم', ids: ['att-board', 'att-requests', 'att-exceptions'] }, { h: 'Leave|الإجازات', ids: ['leave-approvals'] }] },
  { id: 'team', l: 'Team|الفريق', i: 'users', d: 'People, their schedules and their reports.|الأفراد وجداولهم وتقاريرهم.', secs: [{ h: 'People|الأفراد', ids: ['employees', 'numbers', 'import', 'doctypes'] }, { h: 'Planning|التخطيط', ids: ['schedules', 'schedule-rules'] }, { h: 'Reports|التقارير', ids: ['att-report', 'att-statement', 'leave-history'] }] },
  { id: 'catalog', l: 'Catalog|الكتالوج', i: 'tag', d: 'What the business sells.|ما يبيعه النشاط.', secs: [{ h: 'Menu|القائمة', ids: ['services', 'categories'] }, { h: 'Packages|الباقات', ids: ['packages'] }] },
  { id: 'admin', l: 'Business|النشاط', i: 'building', d: 'Identity, rules and access.|الهوية والقواعد والوصول.', secs: [{ h: 'Business|النشاط', ids: ['identity', 'alerts'] }, { h: 'Access|الوصول', ids: ['permissions', 'security'] }, { h: 'Staff app|تطبيق الموظفات', ids: ['applink', 'appcols'] }] },
];
BLOCK.h = (t) => `<h2 class="sech">${E(t)}</h2>`;
const wIds = (w) => w.secs.flatMap((s) => s.ids);
NAV.forEach((w) => { PAGES[`ws-${w.id}`] = { ws: w.id, title: w.l, desc: w.d, blocks: w.secs.flatMap((s) => [['h', s.h], ['hub', s.ids]]) }; });
const findW = (id) => (PAGES[id].ws ? NAV.find((w) => w.id === PAGES[id].ws) : NAV.find((w) => wIds(w).includes(root(id))) || NAV[0]);
const secOf = (w, r) => w.secs.find((s) => s.ids.includes(r));

const Shell = {
  letter: 'C', name: 'Rail + panel',
  mount(app) {
    app.innerHTML = `<div class="shell C ${S.nop ? 'nop' : ''}">
      <nav class="rail" aria-label="${T('Workspaces|مساحات العمل')}">${brand(true)}
        ${NAV.map((w) => `<button type="button" class="rb" data-w="${w.id}" data-act="ws"><span class="bi">${I(w.i)}${badgeN(cnt(wIds(w)))}</span>${E(w.l)}</button>`).join('')}
        <span class="sp"></span><button type="button" class="rb" data-act="find"><span class="bi">${I('search')}</span>${T('Search|بحث')}</button></nav>
      <aside class="pn"></aside>
      <div class="main"><header class="cb"><button class="btn ghost icon pt" data-act="panel" aria-label="${T('Show or hide the page list|إظهار أو إخفاء قائمة الصفحات')}">${I('side')}</button><a class="btn ghost icon bk" aria-label="${T('Back|رجوع')}">${I('back')}</a><div class="cr"></div>
        <div class="utils">${wsBtn('chip')}${utils()}</div></header>
        <div class="scroll" id="view"></div>
        <nav class="bt" aria-label="${T('Workspaces|مساحات العمل')}">${NAV.map((w) => `<a data-w="${w.id}" href="#ws-${w.id}"><span class="bi">${I(w.i)}${badgeN(cnt(wIds(w)))}</span>${E(w.l)}</a>`).join('')}<a href="#" data-act="find"><span class="bi">${I('search')}</span>${T('Search|بحث')}</a></nav></div></div>`;
    $('#app .pn').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); $$('#app .pn .pl').forEach((a) => { a.hidden = !!q && !a.textContent.toLowerCase().includes(q); }); });
  },
  panel(w, r) {
    $('#app .pn').innerHTML = `<div class="ph"><h2>${E(w.l)}</h2><p>${E(w.d)}</p></div>
      <input class="input" type="search" id="pnq" placeholder="${T('Filter this list|تصفية هذه القائمة')}" aria-label="${T('Filter this list|تصفية هذه القائمة')}">
      ${w.secs.map((s) => `<p class="sh">${E(s.h)}</p>${s.ids.map((p) => `<a class="pl" href="#${p}" ${p === r ? 'aria-current="page"' : ''}>${I(PICON[p])}<span>${E(PAGES[p].title)}</span>${badgeN(COUNTS[p])}</a>`).join('')}`).join('')}`;
    $$('#app .rb[data-w]').forEach((b) => b.classList.toggle('peek', b.dataset.w === w.id));
  },
  update(id) {
    this.act('esc');
    const w = findW(id), r = root(id), idx = PAGES[id].ws;
    S.w = w.id;
    $$('#app [data-w]').forEach((b) => { b.toggleAttribute('aria-current', b.dataset.w === w.id); if (b.dataset.w === w.id) b.setAttribute('aria-current', 'page'); });
    this.panel(w, r);
    const s = secOf(w, r);
    $('#app .cr').innerHTML = crumbs(idx ? [[w.l]] : [[w.l, `ws-${w.id}`], [s.h], ...(r !== id ? [[PAGES[r].title, r]] : []), [PAGES[id].title]]);
    const bk = $('#app .bk'); bk.hidden = !!idx; bk.setAttribute('href', `#${r !== id ? r : `ws-${w.id}`}`);
    $('#view').innerHTML = pageHTML(id, { wide: !!idx });
  },
  act(a, el) {
    const app = $('#app'), sh = $('.shell', app);
    if (a === 'esc') { $$('.pal, .scrim.n', app).forEach((e) => e.remove()); if (sh) sh.classList.remove('peeking'); return; }
    if (a === 'panel') { S.nop = !S.nop; sh.classList.toggle('nop', S.nop); return; }
    if (a === 'ws') { /* rail: show that workspace's pages without leaving the current page */
      const w = NAV.find((x) => x.id === el.dataset.w); S.nop = false; sh.classList.remove('nop');
      this.panel(w, root(route())); sh.classList.add('peeking');
      if (!$('.scrim.n', app)) { const sc = document.createElement('div'); sc.className = 'scrim n pk'; sc.onclick = () => Shell.act('esc'); sh.append(sc); }
      return;
    }
    if (a === 'find') {
      this.act('esc');
      const sc = document.createElement('div'); sc.className = 'scrim n'; sc.onclick = () => Shell.act('esc');
      const pal = document.createElement('div'); pal.className = 'pal card'; pal.setAttribute('role', 'dialog');
      const rows = NAV.flatMap((w) => wIds(w).map((p) => `<a href="#${p}" data-k="${esc(`${PAGES[p].title} ${w.l}`.toLowerCase())}">${I(PICON[p])}<span class="tx"><b>${E(PAGES[p].title)}</b><span>${E(w.l)} · ${E(secOf(w, p).h)}</span></span>${I('chev')}</a>`)).join('');
      pal.innerHTML = `<div class="pq">${I('search')}<input id="palq" type="search" placeholder="${T('Go to a page…|انتقل إلى صفحة…')}" aria-label="${T('Go to a page|انتقل إلى صفحة')}"><kbd>Esc</kbd></div><div class="pr">${rows}</div>`;
      app.append(sc, pal);
      const q = $('#palq'); q.focus();
      q.addEventListener('input', () => { const v = q.value.trim().toLowerCase(); $$('.pr a', pal).forEach((x) => { x.hidden = !!v && !x.dataset.k.includes(v); }); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = $('.pr a:not([hidden])', pal); if (f) location.hash = f.getAttribute('href'); } });
    }
  },
  key(e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.act('find'); } },
};
