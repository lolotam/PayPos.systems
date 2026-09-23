// pnpm module-map:generate — writes docs/module-map.yaml from docs/module-map.md §6.
// pnpm module-map:check    — fails when the YAML is stale or any module import breaks the map (plan v4 T12b).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { checkModules, parseModuleMap, renderYaml } from './module-map.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const markdown = readFileSync(`${root}docs/module-map.md`, 'utf8');
const map = parseModuleMap(markdown);
const yaml = renderYaml(map);
const yamlPath = `${root}docs/module-map.yaml`;

if (process.argv[2] === 'generate') {
  writeFileSync(yamlPath, yaml);
  console.log('docs/module-map.yaml written');
} else {
  let committed = '';
  try {
    committed = readFileSync(yamlPath, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    committed = '';
  }
  const problems = committed === yaml ? [] : ['docs/module-map.yaml is stale — run pnpm module-map:generate'];
  problems.push(...checkModules(root, map));
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log('module map: ok');
}
