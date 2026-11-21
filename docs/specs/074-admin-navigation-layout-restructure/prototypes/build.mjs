// Inlines the shared sources and one shell into a single self-contained page per prototype.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const here = new URL('.', import.meta.url);
const read = (f) => readFileSync(new URL(`src/${f}`, here), 'utf8');
const TITLES = { a: 'PosPay Nav A', b: 'PosPay Nav B', c: 'PosPay Nav C' };
for (const v of ['a', 'b', 'c']) {
  if (!existsSync(new URL(`src/${v}.js`, here))) continue;
  const html = `<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLES[v]}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@600;700;800&family=Readex+Pro:wght@400;500;600;700&display=swap">
<style>
${read('base.css')}
${read(`${v}.css`)}
</style>
<script>
${read('data.js')}
${read('core.js')}
${read(`${v}.js`)}
/* The file has no <body> tag of its own (an Artifact adds one); opened as a local file the script runs first, so wait. */
if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
</script>
`;
  writeFileSync(new URL(`pospay-nav-${v}.html`, here), html);
  console.log(`pospay-nav-${v}.html`, html.length);
}
