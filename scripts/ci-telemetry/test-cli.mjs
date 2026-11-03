import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));

// لا يرث الاختبار ملخص خطوات CI إلا إذا اختار ملفه صراحةً.
export const runCli = (args, extraEnv = {}) => {
  const env = { ...process.env, ...extraEnv };
  if (!('GITHUB_STEP_SUMMARY' in extraEnv)) delete env.GITHUB_STEP_SUMMARY;
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env });
};
