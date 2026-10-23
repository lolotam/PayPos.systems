import { spawnSync } from 'node:child_process';

// نسخة البناء (flavour) بتتنقل كمتغير بيئة، مش كوسيط في السطر: كده نفس الأمر بيشتغل على
// ويندوز ولينكس.
const flavour = process.argv[2];

if (flavour !== 'staging' && flavour !== 'production') {
  console.error('Usage: node ./scripts/sync.mjs <staging|production>');
  process.exit(1);
}

// كل منصة بتتزامن لوحدها: Capacitor بيقرا server.hostname على iOS كمان، وiOS لازم
// يفضل على capacitor://localhost (ADR-0055 قرار 3)، فالمزامنة لازم تمرّ من هنا.
const platforms = ['android', 'ios'];

for (const platform of platforms) {
  const result = spawnSync('npx', ['cap', 'sync', platform], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, FLAVOUR: flavour, CAP_PLATFORM: platform },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
