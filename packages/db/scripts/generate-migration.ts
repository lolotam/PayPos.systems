import { spawnSync } from 'node:child_process';

// اسم كل migration: <رقم متسلسل>_<تاريخ UTC>_<الاسم> — drizzle-kit بيحط الرقم، واحنا بنضيف التاريخ.
const [name, ...rest] = process.argv.slice(2);
if (name === undefined || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error('usage: pnpm db:generate <kebab-case-name> [--custom]');
  process.exit(2);
}
const flags = rest.filter((flag) => flag === '--custom');
const date = new Date().toISOString().slice(0, 10);

const result = spawnSync(
  'pnpm',
  ['exec', 'drizzle-kit', 'generate', '--name', `${date}_${name}`, ...flags],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
process.exit(result.status ?? 1);
