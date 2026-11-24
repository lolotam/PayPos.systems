import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type CommandUrls = { readonly owner: string; readonly app: string; readonly dispatcher: string };

/** يشغّل الأمر الحقيقي في عملية منفصلة، ويوجّه كل اتصالاته إلى نسخة الاختبار لا إلى .env المشغّل. */
export function activationCli(
  command: 'switch' | 'issue',
  urls: CommandUrls,
  args: readonly string[],
) {
  const script = fileURLToPath(
    new URL(
      command === 'switch'
        ? '../scripts/platform-commission-approval.ts'
        : '../../../apps/worker/dist/issue-commission-coverage.js',
      import.meta.url,
    ),
  );
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: urls.owner,
          DATABASE_URL: urls.app,
          DISPATCHER_DATABASE_URL: urls.dispatcher,
        },
        timeout: 30_000,
      },
      (error, stdout, stderr) => resolve({ code: error === null ? 0 : 1, stdout, stderr }),
    );
  });
}
