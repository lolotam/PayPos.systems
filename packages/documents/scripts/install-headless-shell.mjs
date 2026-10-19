import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(new URL('../package.json', import.meta.url));
// playwright-core 1.63 ما بيصدّرش ./cli؛ الـ bin هو cli.js جنب package.json.
const cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
const result = spawnSync(
  process.execPath,
  [cli, 'install', ...process.argv.slice(2), 'chromium-headless-shell'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
