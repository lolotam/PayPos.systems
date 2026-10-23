import { spawnSync } from 'node:child_process';

// الطعم بيتنقل كمتغير بيئة، مش كوسيط في السطر: كده نفس الأمر بيشتغل على ويندوز ولينكس.
const flavour = process.argv[2];

if (flavour !== 'staging' && flavour !== 'production') {
  console.error('Usage: node ./scripts/sync.mjs <staging|production>');
  process.exit(1);
}

const result = spawnSync('npx', ['cap', 'sync'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, FLAVOUR: flavour },
});

process.exit(result.status ?? 1);
