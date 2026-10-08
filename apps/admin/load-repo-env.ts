import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parseRepoEnv = `
  const { loadEnvConfig } = require(process.argv[1]);
  const { parsedEnv } = loadEnvConfig(
    process.argv[2], process.env.NODE_ENV !== 'production', console, true,
  );
  process.stdout.write(JSON.stringify(parsedEnv ?? {}));
`;

export function loadRepoEnv(repoRoot: string): void {
  // عزل محمّل Next يحافظ على قيم التطبيق وذاكرته المؤقتة مع نفس قواعد التحليل والأولوية.
  const parsedEnv: Record<string, string> = JSON.parse(
    execFileSync(process.execPath, ['-e', parseRepoEnv, require.resolve('@next/env'), repoRoot], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  for (const [key, value] of Object.entries(parsedEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
