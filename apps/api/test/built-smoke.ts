import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

/** يبدأ artifact مبنياً مرة واحدة، ويوقف نفس العملية قبل حد العشرين ثانية. */
export async function builtSmoke(
  app: 'api' | 'worker',
  env: NodeJS.ProcessEnv,
  port: number,
  check: (base: string) => Promise<void>,
): Promise<void> {
  const cwd = fileURLToPath(new URL(`../../${app}/`, import.meta.url));
  const started = performance.now();
  const child = spawn(process.execPath, ['dist/main.js'], { cwd, env, windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const closed = once(child, 'close');
  const stop = setTimeout(() => child.kill(), 19_000);
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitReady(base, child);
    await check(base);
  } finally {
    child.kill();
    await closed;
    clearTimeout(stop);
    process.stdout.write(
      `SMOKE ${app}: lifetime=${Math.round(performance.now() - started)}ms\n${output}`,
    );
  }
  if (performance.now() - started >= 20_000) throw new Error('SMOKE_LIFETIME_EXCEEDED');
}

async function waitReady(base: string, child: ReturnType<typeof spawn>): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error('SMOKE_PROCESS_EXITED');
    try {
      const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(300) });
      if (response.status === 200) {
        process.stdout.write(`SMOKE ${base}/ready: 200 ${await response.text()}\n`);
        return;
      }
    } catch {
      /* لم يبدأ artifact الاستماع بعد. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('SMOKE_NOT_READY');
}
