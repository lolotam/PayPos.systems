/* Prototype B — task-based top bar with mega menus, a hub page per module, local nav beside the page. */
const NAV = [
  { id: 'today', l: 'Today|اليوم', i: 'home', page: 'home' },
  { id: 'sell', l: 'Sell|البيع', i: 'receipt', d: 'Record what customers buy and review the day.|سجّل مشتريات العملاء وراجع اليوم.', cols: [{ h: 'Record|تسجيل', ids: ['visit', 'pkgsale'] }, { h: 'Review|مراجعة', ids: ['day'] }] },
  { id: 'approvals', l: 'Approvals|الاعتمادات', i: 'inbox', d: 'Everything waiting for your decision, in one place.|كل ما ينتظر قرارك في مكان واحد.', cols: [{ h: 'Waiting for a decision|بانتظار القرار', ids: ['leave-approvals', 'att-requests', 'att-exceptions'] }] },
  { id: 'people', l: 'People|الأفراد', i: 'users', d: 'Records, working time and reports for your team.|السجلات وأوقات العمل وتقارير الفريق.', cols: [{ h: 'Team|الفريق', ids: ['employees', 'numbers', 'import', 'doctypes'] }, { h: 'Time|الوقت', ids: ['schedules', 'att-board'] }, { h: 'Reports|التقارير', ids: ['att-report', 'att-statement', 'leave-history'] }] },
  { id: 'catalog', l: 'Catalog|الكتالوج', i: 'tag', d: 'What the business sells.|ما يبيعه النشاط.', cols: [{ h: 'Menu|القائمة', ids: ['services', 'categories', 'packages'] }] },
  { id: 'setup', l: 'Setup|الإعداد', i: 'gear', d: 'Identity, rules and access for this business.|هوية النشاط وقواعده وصلاحياته.', cols: [{ h: 'Business|النشاط', ids: ['identity', 'alerts', 'schedule-rules'] }, { h: 'Access|الوصول', ids: ['permissions', 'security'] }, { h: 'Staff app|تطبيق الموظفات', ids: ['applink', 'appcols'] }] },
];
BLOCK.h = (t) => `<h2 class="sech">${E(t)}</h2>`;
const mIds = (m) => (m.cols ? m.cols.flatMap((c) => c.ids) : [m.page]);
NAV.filter((m) => m.cols).forEach((m) => { PAGES[`hub-${m.id}`] = { hub: m.id, title: m.l, desc: m.d, blocks: m.cols.flatMap((c) => [['h', c.h], ['hub', c.ids]]) }; });
const findM = (id) => (PAGES[id].hub ? NAV.find((m) => m.id === PAGES[id].hub) : NAV.find((m) => mIds(m).includes(root(id))) || NAV[0]);
const link = (p, r) => `<a href="#${p}" ${p === r ? 'aria-current="page"' : ''}>${I(PICON[p])}<span>${E(PAGES[p].title)}</span>${badgeN(COUNTS[p])}</a>`;

const Shell = {
  letter: 'B', name: 'Top bar + hubs',
  mount(app) {
    app.innerHTML = `<div class="shell B">
      <header class="tb"><button class="btn ghost icon mn" data-act="drawer" aria-label="${T('Open navigation|فتح قائمة التنقل')}">${I('menu')}</button>${brand()}
        <nav class="mods" aria-label="${T('Workspace navigation|التنقل في مساحة العمل')}">${NAV.map((m) => (m.page ? `<a class="mb" data-m="${m.id}" href="#${m.page}">${E(m.l)}</a>` : `<button type="button" class="mb" data-m="${m.id}" data-act="mega" aria-expanded="false">${E(m.l)}${badgeN(cnt(mIds(m)))}${I('down')}</button>`)).join('')}</nav>
        <div class="utils">${utils()}</div></header>
      <div class="ctx">${wsBtn('chip')}<div class="cr"></div></div>
      <div class="body"><aside class="ln"></aside><div class="scroll" id="view"></div></div></div>`;
  },
  update(id) {
    this.act('esc');
    const m = findM(id), r = root(id), hub = PAGES[id].hub;
    $$('#app .mb').forEach((b) => { b.toggleAttribute('aria-current', b.dataset.m === m.id); if (b.dataset.m === m.id) b.setAttribute('aria-current', 'page'); });
    const parts = m.page ? [[m.l]] : hub ? [[m.l]] : [[m.l, `hub-${m.id}`], ...(r !== id ? [[PAGES[r].title, r]] : []), [PAGES[id].title]];
    $('#app .cr').innerHTML = crumbs(parts);
    const local = m.cols && !hub;
    $('#app .body').classList.toggle('nol', !local);
    $('#app .ln').innerHTML = local ? `<a class="ov" href="#hub-${m.id}">${I('grid')}<span>${E(m.l)}</span></a>${m.cols.map((c) => `<p>${E(c.h)}</p>${c.ids.map((p) => link(p, r)).join('')}`).join('')}` : '';
    const strip = local ? `<div class="pills strip">${mIds(m).map((p) => `<a href="#${p}" ${p === r ? 'aria-current="page"' : ''}>${E(PAGES[p].title)} ${badgeN(COUNTS[p])}</a>`).join('')}</div>` : '';
    $('#view').innerHTML = pageHTML(id, { top: strip, wide: !!hub });
    const on = $('#view .strip [aria-current]'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  },
  act(a, el) {
    const app = $('#app');
    if (a === 'esc' || a === 'mega' || a === 'drawer') {
      const open = $('.mega', app), was = open && open.dataset.m;
      $$('.mega, .drawer, .scrim.n', app).forEach((e) => e.remove());
      $$('.mb[aria-expanded]', app).forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (a === 'esc' || (a === 'mega' && was === el.dataset.m)) return;
    }
    const scrim = document.createElement('div'); scrim.className = 'scrim n'; scrim.onclick = () => Shell.act('esc');
    const cur = root(route());
    if (a === 'mega') {
      const m = NAV.find((x) => x.id === el.dataset.m); el.setAttribute('aria-expanded', 'true');
      const box = document.createElement('div'); box.className = 'mega card'; box.dataset.m = m.id;
      box.innerHTML = `<div class="mh"><div><h2>${E(m.l)}</h2><p>${E(m.d)}</p></div><a class="btn sm outline" href="#hub-${m.id}">${T('Overview|نظرة عامة')}${I('chev')}</a></div>
        <div class="mc">${m.cols.map((c) => `<div><p>${E(c.h)}</p>${c.ids.map((p) => `<a href="#${p}" ${p === cur ? 'aria-current="page"' : ''}><span class="hi">${I(PICON[p])}</span><span class="tx"><b>${E(PAGES[p].title)} ${badgeN(COUNTS[p])}</b><span>${E(PAGES[p].desc || '')}</span></span></a>`).join('')}</div>`).join('')}</div>`;
      app.append(scrim, box);
    }
    if (a === 'drawer') {
      const m0 = findM(route());
      const d = document.createElement('aside'); d.className = 'drawer';
      d.innerHTML = `<div class="dh">${brand()}<button class="btn ghost icon" data-act="esc" aria-label="${T('Close navigation|إغلاق قائمة التنقل')}">${I('x')}</button></div>${wsBtn()}
        <nav>${NAV.map((m) => (m.page ? `<a class="dl" href="#${m.page}">${I(m.i)}<span>${E(m.l)}</span></a>` : `<details ${m === m0 ? 'open' : ''}><summary class="dl">${I(m.i)}<span>${E(m.l)}</span>${badgeN(cnt(mIds(m)))}${I('down')}</summary><div class="dd"><a href="#hub-${m.id}">${T('Overview|نظرة عامة')}</a>${mIds(m).map((p) => `<a href="#${p}" ${p === cur ? 'aria-current="page"' : ''}>${E(PAGES[p].title)} ${badgeN(COUNTS[p])}</a>`).join('')}</div></details>`)).join('')}</nav>
        <button class="btn outline sm" data-lang="${S.lang === 'ar' ? 'en' : 'ar'}">${S.lang === 'ar' ? 'English' : 'العربية'}</button>`;
      app.append(scrim, d);
    }
  },
};
