import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export type KillableProcess = {
  kill(signal: NodeJS.Signals): boolean;
  readonly pid?: number;
  readonly children?: readonly KillableProcess[];
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  once?(event: 'exit', listener: () => void): unknown;
  off?(event: 'exit', listener: () => void): unknown;
};

const CLEANUP_KEY = Symbol('launchCleanup');
const RETRY_KEY = Symbol('launchCleanupRetry');
const PID_POLL_MS = 10;
export const LAUNCH_MARKER_ENV = 'POSPAY_CHROMIUM_LAUNCH_ID';

function errorWithCleanup(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'DOCUMENT_LAUNCH_FAILED');
}

/** يربط وعد تنظيف Chromium المتروك ودالة إعادة المحاولة بخطأ الإطلاق عشان المُصيّر يقفل البوابة لحين انتهاء القتل. */
export function withLaunchCleanup(
  error: unknown,
  cleanup: Promise<void>,
  retryKill?: () => Promise<void> | void,
): Error {
  const wrapped = errorWithCleanup(error);
  const safeCleanup = cleanup.then(
    () => undefined,
    (err: unknown) => {
      throw err instanceof Error ? err : new Error('DOCUMENT_LAUNCH_CLEANUP_FAILED');
    },
  );
  safeCleanup.catch(() => undefined);
  Object.defineProperty(wrapped, CLEANUP_KEY, { value: safeCleanup, enumerable: false, configurable: true });
  if (retryKill !== undefined) {
    Object.defineProperty(wrapped, RETRY_KEY, { value: retryKill, enumerable: false, configurable: true });
  }
  return wrapped;
}

/** يقرأ وعد تنظيف Chromium المرتبط بخطأ إطلاق بعد تفرّع العملية إن وُجد. */
export function getLaunchCleanup(error: unknown): Promise<void> | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = (error as Record<symbol, unknown>)[CLEANUP_KEY];
  return value instanceof Promise ? (value as Promise<void>) : undefined;
}

/** يقرأ دالة إعادة قتل عملية الإطلاق الفاشل لو التنظيف الأول اترفض. */
export function getLaunchCleanupRetry(error: unknown): (() => Promise<void> | void) | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = (error as Record<symbol, unknown>)[RETRY_KEY];
  return typeof value === 'function' ? (value as () => Promise<void> | void) : undefined;
}

export function hasExited(proc: KillableProcess): boolean {
  return (
    (proc.exitCode !== undefined && proc.exitCode !== null) ||
    (proc.signalCode !== undefined && proc.signalCode !== null)
  );
}

/** يميز حالة الزومبي أو الخروج في `/proc/<pid>/stat` عشان التنظيف ما يعلّقش من غير reaper. */
export function isLinuxStatZombie(statText: string): boolean {
  const closeParen = statText.lastIndexOf(')');
  if (closeParen === -1) return false;
  const state = statText.slice(closeParen + 1).trimStart()[0];
  return state === 'Z' || state === 'X' || state === 'x';
}

function osPidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === 'EPERM';
  }
}

/** يتحقق إن العملية لسه حيّة ومش زومبي، وما يعتبرش فشل القراءة خروجاً إلا لو فحص النواة أكد ESRCH. */
export function isPidAlive(pid: number, procRoot = '/proc'): boolean {
  if (!osPidExists(pid)) return false;
  if (process.platform === 'linux' || procRoot !== '/proc') {
    try {
      return !isLinuxStatZombie(readFileSync(`${procRoot}/${pid}/stat`, 'utf8'));
    } catch {
      return osPidExists(pid);
    }
  }
  if (process.platform === 'darwin') {
    try {
      const state = execFileSync('ps', ['-o', 'state=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1_000,
      }).trim();
      return state.length === 0 ? osPidExists(pid) : !state.startsWith('Z');
    } catch {
      return osPidExists(pid);
    }
  }
  return true;
}

/** يقرأ أرقام التوابع المباشرة لخيط العملية في procfs ويتجاهل الخيوط اللي خرجت أثناء المسح. */
export function directLinuxChildren(pid: number, procRoot = '/proc'): number[] {
  let tids: string[];
  try {
    tids = readdirSync(`${procRoot}/${pid}/task`);
  } catch {
    return [];
  }
  const found = new Set<number>();
  for (const tid of tids) {
    try {
      const text = readFileSync(`${procRoot}/${pid}/task/${tid}/children`, 'utf8').trim();
      for (const token of text.split(/\s+/)) {
        const child = Number(token);
        if (Number.isInteger(child) && child > 0) found.add(child);
      }
    } catch {
      // الخيط خرج أثناء القراءة؛ نحتفظ بباقي الخيوط والتوابع المجمّعة.
    }
  }
  return [...found];
}

function readLinuxProcessPairs(procRoot = '/proc'): Array<{ pid: number; ppid: number }> {
  let entries: string[];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return [];
  }
  const rows: Array<{ pid: number; ppid: number }> = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`${procRoot}/${entry}/stat`, 'utf8');
      if (isLinuxStatZombie(stat)) continue;
      const closeParen = stat.lastIndexOf(')');
      if (closeParen === -1) continue;
      const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
      const ppid = Number(fields[1]);
      const pid = Number(entry);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid > 0) rows.push({ pid, ppid });
    } catch {
      // العملية خرجت أثناء قراءة stat؛ نكمل باقي العمليات.
    }
  }
  return rows;
}

function readProcessTablePairs(procRoot = '/proc'): Array<{ pid: number; ppid: number }> {
  if (process.platform === 'linux' || procRoot !== '/proc') return readLinuxProcessPairs(procRoot);
  if (process.platform !== 'darwin') return [];
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1_000 });
    return output
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .map(([p, pp]) => ({ pid: Number(p), ppid: Number(pp) }))
      .filter((r) => Number.isInteger(r.pid) && r.pid > 0 && Number.isInteger(r.ppid) && r.ppid > 0);
  } catch {
    return [];
  }
}

const pendingLaunches = new Map<string, KillableProcess | null>();
const launchedMarkers = new WeakMap<KillableProcess, string>();
let spawnHookInstalled = false;

/** يسجل مقبض العملية الذي أطلقه Playwright تحت وسم الإطلاق المقابل. */
export function recordLaunchedProcess(
  env: Record<string, unknown> | undefined,
  proc: KillableProcess,
): void {
  const marker = typeof env?.[LAUNCH_MARKER_ENV] === 'string' ? env[LAUNCH_MARKER_ENV] : undefined;
  if (marker !== undefined && pendingLaunches.has(marker)) {
    pendingLaunches.set(marker, proc);
    launchedMarkers.set(proc, marker);
  }
}

function ensureSpawnHook(): void {
  if (spawnHookInstalled) return;
  spawnHookInstalled = true;
  const require = createRequire(import.meta.url);
  const cp = require('node:child_process') as {
    spawn: (...args: unknown[]) => KillableProcess;
  };
  const originalSpawn = cp.spawn;
  cp.spawn = function patchedSpawn(this: unknown, ...args: unknown[]): KillableProcess {
    const proc = originalSpawn.apply(this, args);
    const maybeOptions = args.length >= 3 ? args[2] : Array.isArray(args[1]) ? undefined : args[1];
    const env =
      maybeOptions !== null && typeof maybeOptions === 'object'
        ? (maybeOptions as { env?: Record<string, unknown> }).env
        : undefined;
    recordLaunchedProcess(env, proc);
    return proc;
  };
}

/** يبدأ تتبّع مقبض العملية الفعلي للإطلاق الحالي قبل استدعاء Playwright. */
export function beginLaunchProcessCapture(launchMarker: string): void {
  ensureSpawnHook();
  pendingLaunches.set(launchMarker, null);
}

/** يسحب مقبض العملية الفعلي الذي أنشأه Playwright لهذا الإطلاق ويمسح التتبّع. */
export function takeLaunchedProcess(launchMarker: string): KillableProcess | null {
  const proc = pendingLaunches.get(launchMarker) ?? null;
  pendingLaunches.delete(launchMarker);
  return proc;
}

function collectDescendantPids(rootPids: readonly number[], procRoot = '/proc'): number[] {
  const result: number[] = [];
  const seen = new Set<number>(rootPids);
  const queue = [...rootPids];
  const table = readProcessTablePairs(procRoot);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const fromTasks = process.platform === 'linux' || procRoot !== '/proc' ? directLinuxChildren(current, procRoot) : [];
    const fromTable = table.filter((row) => row.ppid === current).map((row) => row.pid);
    for (const child of new Set([...fromTasks, ...fromTable])) {
      if (seen.has(child)) continue;
      seen.add(child);
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}

async function waitForPidsExit(pids: readonly number[], procRoot = '/proc'): Promise<void> {
  while (pids.some((pid) => isPidAlive(pid, procRoot))) {
    await new Promise((resolve) => setTimeout(resolve, PID_POLL_MS));
  }
}

function killLaunchProcessGroup(proc: KillableProcess): void {
  if (process.platform === 'win32' || hasExited(proc)) return;
  if (typeof proc.pid !== 'number' || proc.pid <= 0) return;
  try {
    // Playwright بيطلق Chromium بـ detached: true على الأنظمة غير Windows فبيكون قائد مجموعة عمليات (-pid).
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // لو العملية مش قائد مجموعة أو خرجت، proc.kill('SIGKILL') بيتكفل بيها.
  }
}

function hasMatchingMarkerInProc(pid: number, marker: string, procRoot = '/proc'): boolean {
  if (process.platform !== 'linux' && procRoot === '/proc') return false;
  const expected = `${LAUNCH_MARKER_ENV}=${marker}`;
  try {
    const envText = readFileSync(`${procRoot}/${pid}/environ`, 'utf8');
    return envText.split('\0').includes(expected);
  } catch {
    return false;
  }
}

function collectMarkedLinuxPids(marker: string | undefined, procRoot = '/proc'): number[] {
  if (marker === undefined || (process.platform !== 'linux' && procRoot === '/proc')) return [];
  return readLinuxProcessPairs(procRoot)
    .filter((row) => hasMatchingMarkerInProc(row.pid, marker, procRoot))
    .map((row) => row.pid);
}

function toKillError(error: unknown): Error | undefined {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ESRCH') return undefined;
  return error instanceof Error ? error : new Error('SIGKILL_FAILED');
}

function signalDescendantPid(pid: number): Error | undefined {
  if (pid <= 0 || pid === process.pid) return undefined;
  let firstError: Error | undefined;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      firstError = toKillError(error);
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    firstError ??= toKillError(error);
  }
  return firstError;
}

function terminateOwnedDescendants(
  proc: KillableProcess,
  procRoot = '/proc',
): { waitPids: number[]; signalError: Error | undefined } {
  const marker = launchedMarkers.get(proc);
  const rootPid = typeof proc.pid === 'number' && proc.pid > 0 ? proc.pid : undefined;
  const rootAlive = rootPid !== undefined && !hasExited(proc);
  const markedPids = collectMarkedLinuxPids(marker, procRoot);
  const seeds = rootAlive ? [...new Set([rootPid, ...markedPids])] : markedPids;
  if (seeds.length === 0) return { waitPids: [], signalError: undefined };
  const markedSet = new Set(markedPids);
  const candidates = [...new Set([...markedPids, ...collectDescendantPids(seeds, procRoot)])];
  const ownedPids = candidates.filter(
    (pid) => pid !== rootPid && (rootAlive || markedSet.has(pid) || (marker !== undefined && hasMatchingMarkerInProc(pid, marker, procRoot))),
  );
  if (procRoot !== '/proc') return { waitPids: ownedPids, signalError: undefined };
  const waitPids: number[] = [];
  let signalError: Error | undefined;
  for (const pid of ownedPids) {
    const err = signalDescendantPid(pid);
    if (err === undefined) waitPids.push(pid);
    else if (signalError === undefined) signalError = err;
  }
  return { waitPids, signalError };
}

function killSingleAndWait(proc: KillableProcess): Promise<void> | void {
  if (hasExited(proc)) return Promise.resolve();
  const once = proc.once;
  if (typeof once !== 'function') {
    killLaunchProcessGroup(proc);
    const signaled = proc.kill('SIGKILL');
    if (signaled || hasExited(proc)) return;
    throw new Error('SIGKILL_REJECTED');
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      proc.off?.('exit', finish);
      resolve();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      proc.off?.('exit', finish);
      reject(error instanceof Error ? error : new Error('SIGKILL_FAILED'));
    };
    once.call(proc, 'exit', finish);
    if (hasExited(proc)) return finish();
    try {
      killLaunchProcessGroup(proc);
      const signaled = proc.kill('SIGKILL');
      if (hasExited(proc)) finish();
      else if (!signaled) fail(new Error('SIGKILL_REJECTED'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === 'ESRCH' || hasExited(proc)) finish();
      else fail(error);
    }
  });
}

function safeKillSingle(proc: KillableProcess): Promise<void> | undefined {
  try {
    const res = killSingleAndWait(proc);
    return res === undefined ? undefined : res;
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('SIGKILL_FAILED'));
  }
}

/** يقتل عملية Chromium الجذر ومجموعتها وكل شجرة توابعها مع توابع الإطلاق المؤكَّدة قبل فكّ قفل إعادة الإطلاق. */
export function killProcessTree(proc: KillableProcess): Promise<void> | void {
  const childTree = (proc.children ?? []).map((child) => {
    try {
      return killProcessTree(child);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('SIGKILL_FAILED'));
    }
  });
  const { waitPids, signalError } = terminateOwnedDescendants(proc);
  killLaunchProcessGroup(proc);
  const rootWait = safeKillSingle(proc);
  const waits: Array<Promise<void>> = childTree.filter((item): item is Promise<void> => item !== undefined);
  if (waitPids.length > 0) waits.push(waitForPidsExit(waitPids));
  if (signalError !== undefined) waits.push(Promise.reject(signalError));
  if (rootWait === undefined && waits.length === 0) return undefined;
  const all = rootWait === undefined ? waits : [rootWait, ...waits];
  return Promise.allSettled(all).then((results) => {
    const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (rejected !== undefined) throw rejected.reason;
  });
}
