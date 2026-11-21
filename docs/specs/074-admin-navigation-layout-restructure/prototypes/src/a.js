/* Prototype A — six sidebar entries; second level is a tab row; third level is pills. */
const NAV = [
  { id: 'home', l: 'Home|الرئيسية', i: 'home', tabs: [{ p: 'home' }] },
  { id: 'sales', l: 'Sales|المبيعات', i: 'receipt', tabs: [{ p: 'visit' }, { p: 'day' }, { p: 'pkgsale' }] },
  { id: 'catalog', l: 'Catalog|الكتالوج', i: 'tag', tabs: [{ p: 'services' }, { p: 'categories' }, { p: 'packages' }] },
  { id: 'team', l: 'Team|الفريق', i: 'users', tabs: [
    { p: 'employees', sub: ['employees', 'numbers', 'import', 'doctypes'] },
    { p: 'schedules', l: 'Schedules|الجداول', sub: ['schedules', 'schedule-rules'] }] },
  { id: 'time', l: 'Attendance & leave|الحضور والإجازات', i: 'clock', tabs: [
    { p: 'att-board', l: 'Board|اللوحة' }, { p: 'att-requests', l: 'Requests|الطلبات' }, { p: 'att-exceptions', l: 'Exceptions|التحذيرات' },
    { p: 'leave-approvals' }, { p: 'att-report', l: 'Reports|التقارير', sub: ['att-report', 'att-statement', 'leave-history'] }] },
  { id: 'setup', l: 'Setup|الإعداد', i: 'gear', tabs: [
    { p: 'identity' }, { p: 'permissions' }, { p: 'alerts' },
    { p: 'applink', l: 'Staff app|تطبيق الموظفات', sub: ['applink', 'appcols'] }, { p: 'security', l: 'Sign-in security|أمان الدخول' }] },
];
const SUBL = { employees: 'List|القائمة', schedules: 'Week|الأسبوع', 'schedule-rules': 'Shift limits|حدود الورديات', applink: 'Link and QR|الرابط و QR', appcols: 'Columns|الأعمدة' };
const tabIds = (t) => t.sub || [t.p];
const grpIds = (g) => g.tabs.flatMap(tabIds);
function find(id) { const r = root(id); for (const g of NAV) for (const t of g.tabs) if (tabIds(t).includes(r)) return { g, t }; return { g: NAV[0], t: NAV[0].tabs[0] }; }
const gHref = (g) => S.last[g.id] || g.tabs[0].p;

const Shell = {
  letter: 'A', name: 'Sidebar + tabs',
  mount(app) {
    const bb = [NAV[0], NAV[1], NAV[3], NAV[4]];
    app.innerHTML = `<div class="shell A ${S.col ? 'col' : ''}">
      <aside class="sb"><div class="sbh">${brand()}<button class="btn ghost icon cl" data-act="collapse" aria-label="${T('Collapse navigation|طي القائمة')}">${I('side')}</button></div>
        ${wsBtn()}
        <nav class="nv" aria-label="${T('Workspace navigation|التنقل في مساحة العمل')}"><span class="ind"></span>
          ${NAV.map((g) => `<a class="ni" data-g="${g.id}" href="#${gHref(g)}" title="${E(g.l)}">${I(g.i)}<span class="lb">${E(g.l)}</span>${badgeN(cnt(grpIds(g)))}</a>`).join('')}</nav>
      </aside>
      <div class="main"><header class="top"><h2 class="sect"></h2><div class="utils">${utils()}</div></header>
        <div class="tabsrow"></div><div class="scroll" id="view"></div>
        <nav class="bb" aria-label="${T('Workspace navigation|التنقل في مساحة العمل')}">${bb.map((g) => `<a data-g="${g.id}" href="#${gHref(g)}"><span class="bi">${I(g.i)}</span>${E(g.l.replace('Attendance & leave|الحضور والإجازات', 'Time|الدوام'))}</a>`).join('')}
          <a href="#" data-act="more" data-g="more"><span class="bi">${I('dots')}</span>${T('More|المزيد')}</a></nav></div></div>`;
  },
  update(id) {
    const { g, t } = find(id), r = root(id);
    S.last[g.id] = r;
    $$('#app [data-g]').forEach((a) => {
      const on = a.dataset.g === g.id || (a.dataset.g === 'more' && ['catalog', 'setup'].includes(g.id));
      a.toggleAttribute('aria-current', on); if (on) a.setAttribute('aria-current', 'page');
      const ng = NAV.find((x) => x.id === a.dataset.g); if (ng) a.setAttribute('href', `#${gHref(ng)}`);
    });
    const cur = $(`#app .ni[data-g="${g.id}"]`), ind = $('#app .ind');
    ind.style.transform = `translateY(${cur.offsetTop}px)`; ind.style.height = `${cur.offsetHeight}px`;
    $('#app .sect').textContent = T(g.l);
    const row = $('#app .tabsrow');
    row.hidden = g.tabs.length < 2;
    row.innerHTML = `<div class="tabs">${g.tabs.map((x) => `<a href="#${x.p}" ${x === t ? 'aria-current="page"' : ''}>${E(x.l || PAGES[x.p].title)} ${badgeN(cnt(tabIds(x)))}</a>`).join('')}</div>`;
    const on = $('.tabs [aria-current]', row); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    const pills = t.sub ? `<div class="pills">${t.sub.map((p) => `<a href="#${p}" ${p === r ? 'aria-current="page"' : ''}>${E(SUBL[p] || PAGES[p].title)}</a>`).join('')}</div>` : '';
    const top = r !== id ? crumbs([[g.l], [PAGES[r].title, r], [PAGES[id].title]]) : '';
    $('#view').innerHTML = pageHTML(id, { top, mid: r === id ? pills : '' });
  },
  act(a, el) {
    if (a === 'collapse') { S.col = !S.col; $('#app .shell').classList.toggle('col', S.col); setTimeout(() => Shell.update(route()), 210); }
    if (a === 'more') openPop('more', el, `<h2>${T('More|المزيد')}</h2><div class="list">${[NAV[2], NAV[5]].map((g) => `<a class="li" href="#${gHref(g)}"><span class="hi">${I(g.i)}</span><span class="tx"><b>${E(g.l)}</b><span>${g.tabs.map((x) => T(x.l || PAGES[x.p].title)).join(' · ')}</span></span>${I('chev')}</a>`).join('')}</div>${wsBtn()}`);
  },
};
