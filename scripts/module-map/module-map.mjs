// The module-map gate (plan v4 T12b, docs/module-map.md §6). Imports are read with the TypeScript compiler — every
// form (import, export … from, import(), require, side-effect imports, type-only) — and resolved with each project's
// own tsconfig, so an alias or a `.js` specifier is judged by the file it really reaches.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

const BLOCK = /## 6\. Machine-readable source[\s\S]*?```yaml\n([\s\S]*?)```/;

/**
 * Parses the §6 block of module-map.md. Any line it cannot read is an error, never skipped.
 *
 * @param {string} markdown the whole of docs/module-map.md
 * @returns {{ imports: Record<string, string[]>, packagesRestricted: Record<string, string[]>,
 *   syncWrites: { from: string, to: string, symbol: string, file: string }[],
 *   reads: { from: string, to: string, symbol: string, file: string }[] }}
 */
export function parseModuleMap(markdown) {
  const block = BLOCK.exec(markdown.replace(/\r\n/g, '\n'))?.[1];
  if (block === undefined) throw new Error('module-map.md has no §6 yaml block');
  const map = { imports: {}, packagesRestricted: {}, syncWrites: [], reads: [] };
  const sections = new Set(['imports', 'packages_restricted', 'sync_writes', 'reads']);
  let section = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (line.trim() === '') continue;
    const top = /^(\w+):\s*(\[\])?$/.exec(line);
    if (top !== null) {
      if (!sections.has(top[1])) throw new Error(`module-map.md §6: unknown section "${top[1]}"`);
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
    Object.keys(record).sort().map((key) => `  ${key}: [${record[key].join(', ')}]`);
  const entries = (list) =>
    list.map((e) => `  - { from: ${e.from}, to: ${e.to}, symbol: ${e.symbol}, file: ${e.file} }`);
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

const isTest = (path) => /[\\/]__tests__[\\/]/.test(path) || /\.(spec|test)\.ts$/.test(path);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist') files.push(...walk(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !isTest(path)) {
      files.push(path);
    }
  }
  return files;
}

const exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

function compilerOptions(project) {
  const config = join(project, 'tsconfig.json');
  if (!exists(config)) return { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  return parsed?.options ?? {};
}

/**
 * Every dependency one file declares. `names` are the value bindings it brings in — `'*'` when it cannot be known
 * (namespace, dynamic import, require, side-effect import).
 *
 * @param {string} file absolute path
 * @returns {{ spec: string, kind: string, typeOnly: boolean, names: string[], locals: string[] }[] & { exported: Set<string> }}
 */
export function dependenciesOf(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found = [];
  const exported = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const spec = node.moduleSpecifier.text;
      if (clause === undefined) {
        found.push({ spec, kind: 'side-effect', typeOnly: false, names: ['*'], locals: [] });
      } else {
        const names = [];
        const locals = [];
        if (!clause.isTypeOnly) {
          if (clause.name !== undefined) (names.push('default'), locals.push(clause.name.text));
          const bindings = clause.namedBindings;
          if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            names.push('*');
            locals.push(bindings.name.text);
          } else if (bindings !== undefined) {
            for (const element of bindings.elements) {
              if (element.isTypeOnly) continue;
              names.push((element.propertyName ?? element.name).text);
              locals.push(element.name.text);
            }
          }
        }
        found.push({ spec, kind: 'import', typeOnly: names.length === 0, names, locals });
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        const elements = node.exportClause !== undefined && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.filter((e) => !e.isTypeOnly)
          : null;
        const names = node.isTypeOnly ? [] : elements === null ? ['*'] : elements.map((e) => (e.propertyName ?? e.name).text);
        found.push({ spec: node.moduleSpecifier.text, kind: 're-export', typeOnly: names.length === 0, names, locals: [] });
      } else if (node.exportClause !== undefined && ts.isNamedExports(node.exportClause) && !node.isTypeOnly) {
        for (const element of node.exportClause.elements) exported.add((element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      exported.add(node.expression.text);
    } else if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer !== undefined && ts.isIdentifier(declaration.initializer)) {
          exported.add(declaration.initializer.text);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((dynamic || required) && argument !== undefined && ts.isStringLiteralLike(argument)) {
        found.push({ spec: argument.text, kind: dynamic ? 'dynamic' : 'require', typeOnly: false, names: ['*'], locals: [] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.assign(found, { exported });
}

function resolveTo(spec, file, options) {
  const resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule;
  if (resolved === undefined || resolved.isExternalLibraryImport === true) return null;
  return resolve(resolved.resolvedFileName);
}

function cyclesOf(graph, label) {
  const found = new Set();
  const state = new Map();
  const visit = (node, path) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'active') {
      found.add(`${label} cycle: ${[...path.slice(path.indexOf(node)), node].join(' -> ')}`);
      return;
    }
    state.set(node, 'active');
    for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
    state.set(node, 'done');
  };
  for (const node of graph.keys()) visit(node, []);
  return [...found];
}

function projects(root) {
  return ['apps', 'packages'].filter((top) => exists(join(root, top))).flatMap((top) =>
    readdirSync(join(root, top))
      .map((name) => join(root, top, name))
      .filter((dir) => exists(join(dir, 'src'))),
  );
}

// Where a file sits: its app, and the module it belongs to (null for app-level code such as shared/ or app.ts).
function place(root, file) {
  const parts = relative(root, file).split(sep);
  if (parts[0] !== 'apps' || parts[2] !== 'src') return { app: null, module: null, top: false };
  const module = parts[3] === 'modules' && parts.length > 5 ? parts[4] : null;
  // The composition root: files directly in src/ (app.ts, main.ts, worker.ts) wire modules together.
  return { app: parts[1], module, top: parts.length === 4 };
}

function packageCycles(root) {
  const graph = new Map();
  for (const project of projects(root)) {
    const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@pospay/'));
    graph.set(pkg.name, new Set(deps));
  }
  return cyclesOf(graph, 'package');
}

/**
 * Checks every source file of every app and package against the map. Returns the violations; empty passes.
 *
 * @param {string} root the repository root
 * @param {ReturnType<typeof parseModuleMap>} map the parsed §6 block
 * @returns {string[]} one line per violation
 */
export function checkModules(root, map) {
  const problems = [];
  const moduleGraph = new Map();
  const fileGraph = new Map();
  const allowed = [...map.syncWrites, ...map.reads];
  for (const project of projects(root)) {
    const options = compilerOptions(project);
    for (const file of walk(join(project, 'src'))) {
      const rel = relative(root, file).split(sep).join('/');
      const from = place(root, file);
      const deps = dependenciesOf(file);
      const crossLocals = new Set();
      for (const dep of deps) {
        const target = resolveTo(dep.spec, file, options);
        if (target !== null && !dep.typeOnly) {
          fileGraph.set(file, new Set([...(fileGraph.get(file) ?? []), target]));
        }
        const pkg = /^@pospay\/([\w-]+)/.exec(dep.spec)?.[1];
        const owners = pkg === undefined ? undefined : map.packagesRestricted[pkg];
        if (from.module !== null && owners !== undefined && !owners.includes(from.module)) {
          problems.push(`${rel}: @pospay/${pkg} may be imported only by ${owners.join(', ')}`);
        }
        if (target === null) continue;
        const to = place(root, target);
        if (to.module === null || to.app !== from.app || to.module === from.module) {
          if (from.module !== null && to.top) {
            problems.push(`${rel}: a module imports the composition root (${dep.spec})`);
          }
          continue;
        }
        if (from.module === null) {
          if (!from.top) problems.push(`${rel}: only the composition root may import a module (${dep.spec})`);
          continue;
        }
        const other = to.module;
        moduleGraph.set(from.module, new Set([...(moduleGraph.get(from.module) ?? []), other]));
        const index = join(root, 'apps', to.app, 'src', 'modules', other, 'index.ts');
        if (target !== index) problems.push(`${rel}: deep import into ${other} (${dep.spec}) — only ${other}/index.ts`);
        if (!(map.imports[from.module] ?? []).includes(other)) {
          problems.push(`${rel}: arrow ${from.module} -> ${other} is not declared in docs/module-map.md`);
        }
        if (dep.kind === 're-export') {
          problems.push(`${rel}: re-exports ${other} — a module's surface is its own`);
          continue;
        }
        for (const name of dep.names) {
          const ok = dep.kind === 'import' && allowed.some(
            (e) => e.from === from.module && e.to === other && e.symbol === name && e.file === rel,
          );
          if (!ok) {
            problems.push(`${rel}: value import ${other}.${name} (${dep.kind}) is neither the declared synchronous write nor a declared read`);
          }
        }
        dep.locals.forEach((local) => crossLocals.add(local));
      }
      for (const local of crossLocals) {
        if (deps.exported.has(local)) problems.push(`${rel}: exports ${local}, which it imported from another module`);
      }
    }
  }
  const declared = new Map(Object.entries(map.imports).map(([k, v]) => [k, new Set(v)]));
  problems.push(...cyclesOf(moduleGraph, 'module'), ...cyclesOf(declared, 'declared module'));
  const relGraph = new Map([...fileGraph].map(([k, v]) => [relative(root, k).split(sep).join('/'), new Set([...v].map((t) => relative(root, t).split(sep).join('/')))]));
  problems.push(...cyclesOf(relGraph, 'file'), ...packageCycles(root));
  return [...new Set(problems)];
}
