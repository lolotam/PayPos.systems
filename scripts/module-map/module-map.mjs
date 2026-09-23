// The module-map gate (plan v4 T12b, docs/module-map.md §6). No dependency: the §6 block is a small, fixed YAML shape,
// read line by line, and the imports are read with the same regular expressions everywhere.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const BLOCK = /## 6\. Machine-readable source[\s\S]*?```yaml\n([\s\S]*?)```/;

/**
 * Parses the §6 block of module-map.md.
 *
 * @param {string} markdown the whole of docs/module-map.md
 * @returns {{ imports: Record<string, string[]>, packagesRestricted: Record<string, string[]>,
 *   syncWrites: { from: string, to: string, symbol: string, file: string }[],
 *   reads: { from: string, to: string, symbol: string, file: string }[] }}
 */
export function parseModuleMap(markdown) {
  const block = BLOCK.exec(markdown)?.[1];
  if (block === undefined) throw new Error('module-map.md has no §6 yaml block');
  const map = { imports: {}, packagesRestricted: {}, syncWrites: [], reads: [] };
  let section = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    const top = /^(\w+):\s*(\[\])?$/.exec(line);
    if (top !== null) {
      section = top[1];
      continue;
    }
    const pair = /^\s+([\w-]+):\s*\[([^\]]*)\]$/.exec(line);
    const entry = /^\s+-\s+(\w+)\s*->\s*(\w+)\.(\w+)\s*@\s*(\S+)$/.exec(line);
    if (pair !== null && (section === 'imports' || section === 'packages_restricted')) {
      const list = pair[2].split(',').map((v) => v.trim()).filter(Boolean);
      map[section === 'imports' ? 'imports' : 'packagesRestricted'][pair[1]] = list;
    } else if (entry !== null && (section === 'sync_writes' || section === 'reads')) {
      const [, from, to, symbol, file] = entry;
      map[section === 'sync_writes' ? 'syncWrites' : 'reads'].push({ from, to, symbol, file });
    } else {
      throw new Error(`module-map.md §6: cannot read line "${raw.trim()}"`);
    }
  }
  return map;
}

/**
 * The generated docs/module-map.yaml — deterministic, so a stale committed copy is a diff.
 *
 * @param {ReturnType<typeof parseModuleMap>} map the parsed §6 block
 * @returns {string} the YAML text
 */
export function renderYaml(map) {
  const pairs = (record) =>
    Object.keys(record)
      .sort()
      .map((key) => `  ${key}: [${record[key].join(', ')}]`);
  const entries = (list) =>
    list.length === 0
      ? []
      : list.map((e) => `  - { from: ${e.from}, to: ${e.to}, symbol: ${e.symbol}, file: ${e.file} }`);
  return [
    '# GENERATED from docs/module-map.md §6 by `pnpm module-map:generate` — edit the markdown, not this file.',
    'imports:',
    ...pairs(map.imports),
    'packages_restricted:',
    ...pairs(map.packagesRestricted),
    map.syncWrites.length === 0 ? 'sync_writes: []' : 'sync_writes:',
    ...entries(map.syncWrites),
    map.reads.length === 0 ? 'reads: []' : 'reads:',
    ...entries(map.reads),
    '',
  ].join('\n');
}

const IMPORT =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') files.push(...walk(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files;
}

// The names a statement brings in as values: `import type {…}` and `type X` members bring none.
function valueNames(isType, clause) {
  if (isType) return [];
  const braces = /\{([\s\S]*)\}/.exec(clause);
  const inside = braces === null ? [] : braces[1].split(',');
  const outside = braces === null ? clause.split(',') : [clause.replace(braces[0], '')];
  return [...inside, ...outside]
    .map((n) => n.trim())
    .filter((n) => n !== '' && !n.startsWith('type '))
    .map((n) => n.split(/\s+as\s+/)[0].replace(/^\*\s*$/, '*').trim());
}

/**
 * Checks every module's imports against the map. Returns the violations; an empty list passes.
 *
 * @param {string} root the repository root
 * @param {ReturnType<typeof parseModuleMap>} map the parsed §6 block
 * @returns {string[]} one line per violation
 */
export function checkModules(root, map) {
  const problems = [];
  const used = new Map();
  const modulesDirs = ['apps']
    .flatMap((top) => readdirSync(join(root, top)).map((app) => join(root, top, app, 'src', 'modules')))
    .filter((dir) => { try { return statSync(dir).isDirectory(); } catch { return false; } });
  const allowed = [...map.syncWrites, ...map.reads];
  for (const modulesDir of modulesDirs) {
    for (const module of readdirSync(modulesDir)) {
      for (const file of walk(join(modulesDir, module))) {
        const text = readFileSync(file, 'utf8');
        const rel = relative(root, file).split(sep).join('/');
        for (const match of text.matchAll(IMPORT)) {
          const [, , typeKeyword, clause, spec] = match;
          const owners = map.packagesRestricted[spec.replace(/^@pospay\//, '')];
          if (spec.startsWith('@pospay/') && owners !== undefined && !owners.includes(module)) {
            problems.push(`${rel}: ${spec} may be imported only by ${owners.join(', ')}`);
          }
          if (!spec.startsWith('.')) continue;
          const target = resolve(dirname(file), spec);
          const inModules = relative(modulesDir, target).split(sep);
          if (inModules[0] === '..' || inModules[0] === module) continue;
          const other = inModules[0];
          if (inModules.length !== 2 || inModules[1] !== 'index.ts') {
            problems.push(`${rel}: deep import into ${other} (${spec}) — only ${other}/index.ts`);
          }
          if (!(map.imports[module] ?? []).includes(other)) {
            problems.push(`${rel}: arrow ${module} -> ${other} is not declared in docs/module-map.md`);
          }
          used.set(module, new Set([...(used.get(module) ?? []), other]));
          for (const name of valueNames(typeKeyword !== undefined, clause)) {
            const ok = allowed.some(
              (e) => e.from === module && e.to === other && e.symbol === name && e.file === rel,
            );
            if (!ok) {
              problems.push(
                `${rel}: value import ${other}.${name} is neither the declared synchronous write nor a declared read`,
              );
            }
          }
        }
      }
    }
  }
  problems.push(...cycles(used), ...cycles(new Map(Object.entries(map.imports).map(([k, v]) => [k, new Set(v)]))));
  return problems;
}

function cycles(graph) {
  const found = [];
  const state = new Map();
  const visit = (node, path) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'active') {
      found.push(`import cycle: ${[...path.slice(path.indexOf(node)), node].join(' -> ')}`);
      return;
    }
    state.set(node, 'active');
    for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
    state.set(node, 'done');
  };
  for (const node of graph.keys()) visit(node, []);
  return [...new Set(found)];
}
