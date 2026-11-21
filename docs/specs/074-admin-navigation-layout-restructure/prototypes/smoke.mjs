// Renders every page of every shell in both languages and checks each shell's nav covers every root page once.
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(`src/${f}`, import.meta.url), 'utf8');
function check() {
  const base = Object.keys(PAGES).filter((k) => !PAGES[k].hub && !PAGES[k].ws);
  const roots = base.filter((k) => !PAGES[k].parent).sort();
  const ids = typeof grpIds === 'function' ? grpIds : typeof mIds === 'function' ? mIds : wIds;
  const navIds = NAV.flatMap(ids).sort();
  let n = 0;
  for (const lang of ['ar', 'en']) {
    S.lang = lang;
    for (const id of Object.keys(PAGES)) {
      const st = PAGES[id].blocks.find((b) => b[0] === 'subtabs');
      (st ? st[1] : [0]).forEach((_, i) => {
        S.sub[id] = i; const h = pageHTML(id); n += 1;
        const bad = h.match(/.{0,40}(undefined|\[object|NaN).{0,40}/);
        if (!h.includes('<h1>') || bad) throw new Error(`${lang} ${id} tab ${i}: ${bad ? bad[0] : 'no h1'}`);
      });
    }
  }
  return { n, roots, navIds, dup: navIds.filter((x, i) => navIds.indexOf(x) !== i) };
}
let fail = 0;
for (const v of ['a', 'b', 'c']) {
  const src = [read('data.js'), read('core.js'), read(`${v}.js`), `return (${check.toString()})();`].join('\n');
  try {
    const r = new Function('document', 'location', src)({ documentElement: { dataset: {} } }, { hash: '' });
    const same = JSON.stringify(r.roots) === JSON.stringify(r.navIds);
    console.log(v.toUpperCase(), 'renders:', r.n, 'root pages:', r.roots.length, 'nav ids:', r.navIds.length, 'match:', same, 'dup:', r.dup.join(',') || 'none');
    if (!same) { fail = 1; console.log('  missing:', r.roots.filter((x) => !r.navIds.includes(x)), 'extra:', r.navIds.filter((x) => !r.roots.includes(x))); }
  } catch (e) { fail = 1; console.log(v.toUpperCase(), 'FAIL', e.message); }
}
process.exit(fail);
