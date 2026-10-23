import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// نسخة البناء (flavour) بتتنقل كمتغير بيئة، مش كوسيط في السطر: كده نفس الأمر بيشتغل على
// ويندوز ولينكس.
const flavour = process.argv[2];

const ORIGINS = {
  staging: 'https://api.staging.pospay.systems',
  production: 'https://api.pospay.systems',
};

if (flavour !== 'staging' && flavour !== 'production') {
  console.error('Usage: node ./scripts/sync.mjs <staging|production>');
  process.exit(1);
}

// الـ API origin متخبّط جوّه حزمة dist-native، فلازم نتأكد إنها بتاعة النسخة اللي بنزامنها.
function checkBuiltFlavour(name) {
  const assets = fileURLToPath(new URL('../../pos/dist-native/assets', import.meta.url));
  const rebuild = `VITE_API_URL=${ORIGINS[name]} FLAVOUR=${name} pnpm --filter @pospay/pos build:native`;
  if (!existsSync(assets)) {
    process.stderr.write(`${name}: no dist-native build found. Rebuild with: ${rebuild}\n`);
    process.exit(1);
  }
  const other = name === 'staging' ? 'production' : 'staging';
  let found = false;
  for (const file of readdirSync(assets)) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(join(assets, file), 'utf8');
    if (source.includes(ORIGINS[other])) {
      process.stderr.write(`${name}: dist-native holds the ${other} build. Rebuild with: ${rebuild}\n`);
      process.exit(1);
    }
    if (source.includes(ORIGINS[name])) found = true;
  }
  if (!found) {
    process.stderr.write(`${name}: dist-native holds no ${name} API origin. Rebuild with: ${rebuild}\n`);
    process.exit(1);
  }
}

// كل منصة بتتزامن لوحدها: Capacitor بيقرا server.hostname على iOS كمان، وiOS لازم
// يفضل على capacitor://localhost (ADR-0055 قرار 3)، فالمزامنة لازم تمرّ من هنا.
const platforms = ['android', 'ios'];

checkBuiltFlavour(flavour);

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
