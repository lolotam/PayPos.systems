import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgPath = require.resolve('openapi-typescript/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['openapi-typescript'];
const cli = join(dirname(pkgPath), bin);
const spec = join(root, '../../../packages/contracts/openapi/openapi.json');
const committedPath = join(root, '../src/shared/api/schema.d.ts');

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

const result = spawnSync(process.execPath, [cli, spec], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'openapi-typescript failed\n');
  process.exit(result.status ?? 1);
}

const generated = normalize(result.stdout ?? '');
const committed = normalize(readFileSync(committedPath, 'utf8'));

if (generated !== committed) {
  process.stderr.write('schema.d.ts is stale — run pnpm --filter @pospay/pos api:generate\n');
  process.exit(1);
}
