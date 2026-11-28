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
const UNCONFIRMED_DESCENDANT_KEY = Symbol('unconfirmedDescendantKill');
const PID_POLL_MS = 10;
export const LAUNCH_MARKER_ENV = 'POSPAY_CHROMIUM_LAUNCH_ID';

function markUnconfirmedDescendants(error: Error): Error {
  Object.defineProperty(error, UNCONFIRMED_DESCENDANT_KEY, { value: true, enumerable: false, configurable: true });
  return error;
}

/** يتحقق إن فشل القتل سببه بقاء تابع مكتشف حيّاً عشان إغلاق المتصفح الجذر ما يفتحش البوابة بالغلط. */
export function hasUnconfirmedDescendants(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as Record<symbol, unknown>)[UNCONFIRMED_DESCENDANT_KEY] === true;
}

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

function collectDescendantPids(rootPids: readonly number[], procRoot = '/proc'): Map<number, number> {
  const seedOf = new Map<number, number>(rootPids.map((pid) => [pid, pid]));
  const queue = [...rootPids];
  const table = readProcessTablePairs(procRoot);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const origin = seedOf.get(current) ?? current;
    const fromTasks = process.platform === 'linux' || procRoot !== '/proc' ? directLinuxChildren(current, procRoot) : [];
    const fromTable = table.filter((row) => row.ppid === current).map((row) => row.pid);
    for (const child of new Set([...fromTasks, ...fromTable])) {
      if (seedOf.has(child)) continue;
      seedOf.set(child, origin);
      queue.push(child);
    }
  }
  return seedOf;
}

function checkPidStatus(pid: number, expectedFp: string, procRoot = '/proc'): 'exited' | 'same' | 'unverified' {
  const cur = readPidFingerprint(pid, procRoot);
  if (cur === undefined || (expectedFp !== '' && cur !== null && cur !== expectedFp)) return 'exited';
  return expectedFp !== '' && cur === expectedFp ? 'same' : 'unverified';
}

async function waitForPidsExit(targets: ReadonlyArray<readonly [number, string]>, procRoot = '/proc'): Promise<void> {
  while (targets.some(([pid, fp]) => checkPidStatus(pid, fp, procRoot) !== 'exited')) {
    await new Promise((resolve) => setTimeout(resolve, PID_POLL_MS));
  }
}

function killLaunchProcessGroup(proc: KillableProcess): void {
  if (process.platform === 'win32' || hasExited(proc) || typeof proc.pid !== 'number' || proc.pid <= 0) return;
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* proc.kill يتكفل */ }
}

function hasMatchingMarkerInProc(pid: number, marker: string, procRoot = '/proc'): boolean {
  if (process.platform !== 'linux' && procRoot === '/proc') return false;
  try { return readFileSync(`${procRoot}/${pid}/environ`, 'utf8').split('\0').includes(`${LAUNCH_MARKER_ENV}=${marker}`); } catch { return false; }
}

function collectMarkedLinuxPids(marker: string | undefined, procRoot = '/proc'): number[] {
  if (marker === undefined || (process.platform !== 'linux' && procRoot === '/proc')) return [];
  return readLinuxProcessPairs(procRoot).filter((row) => hasMatchingMarkerInProc(row.pid, marker, procRoot)).map((row) => row.pid);
}

function toKillError(error: unknown): Error | undefined {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return code === 'ESRCH' ? undefined : (error instanceof Error ? error : new Error('SIGKILL_FAILED'));
}

function signalDescendantPid(pid: number): Error | undefined {
  if (pid <= 0 || pid === process.pid) return undefined;
  let err: Error | undefined;
  if (process.platform !== 'win32') try { process.kill(-pid, 'SIGKILL'); } catch (e) { err = toKillError(e); }
  try { process.kill(pid, 'SIGKILL'); } catch (e) { err ??= toKillError(e); }
  return err;
}

const retainedDescendants = new WeakMap<KillableProcess, Map<number, string>>();

function readPidFingerprint(pid: number, procRoot = '/proc'): string | null | undefined {
  if (!isPidAlive(pid, procRoot)) return undefined;
  if (process.platform === 'linux' || procRoot !== '/proc') {
    try {
      const stat = readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
      if (isLinuxStatZombie(stat)) return undefined;
      const end = stat.lastIndexOf(')');
      const start = end === -1 ? undefined : stat.slice(end + 1).trim().split(/\s+/)[19];
      return start !== undefined && start.length > 0 ? `linux:${start}` : `stat:${stat.trim()}`;
    } catch { return isPidAlive(pid, procRoot) ? null : undefined; }
  }
  if (process.platform !== 'darwin') return 'alive';
  try {
    const lstart = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1_000 }).trim();
    return lstart.length > 0 ? `darwin:${lstart}` : (isPidAlive(pid, procRoot) ? null : undefined);
  } catch { return isPidAlive(pid, procRoot) ? null : undefined; }
}

function revalidateRetained(proc: KillableProcess, procRoot: string): { pids: number[]; unverifiedError: Error | undefined } {
  const prior = retainedDescendants.get(proc);
  if (prior === undefined) return { pids: [], unverifiedError: undefined };
  const pids: number[] = [];
  let unverifiedError: Error | undefined;
  for (const [pid, expectedFp] of prior) {
    const status = checkPidStatus(pid, expectedFp, procRoot);
    if (status === 'exited') prior.delete(pid);
    else if (status === 'same') pids.push(pid);
    else unverifiedError ??= markUnconfirmedDescendants(new Error('DESCENDANT_IDENTITY_UNVERIFIED'));
  }
  if (prior.size === 0) retainedDescendants.delete(proc);
  return { pids, unverifiedError };
}

function terminateOwnedDescendants(
  proc: KillableProcess,
  procRoot = '/proc',
): { waitPids: number[]; signalError: Error | undefined } {
  const marker = launchedMarkers.get(proc);
  const rootPid = typeof proc.pid === 'number' && proc.pid > 0 ? proc.pid : undefined;
  const rootAlive = rootPid !== undefined && !hasExited(proc);
  const markedPids = collectMarkedLinuxPids(marker, procRoot);
  const { pids: retainedPids, unverifiedError } = revalidateRetained(proc, procRoot);
  const seeds = [...new Set([...(rootAlive && rootPid !== undefined ? [rootPid] : []), ...markedPids, ...retainedPids])];
  if (seeds.length === 0) return { waitPids: [], signalError: unverifiedError };
  const markedSet = new Set(markedPids);
  const retainedSet = new Set(retainedPids);
  const seedOf = collectDescendantPids(seeds, procRoot);
  const ownedPids = [...seedOf.keys()].filter((pid) => {
    const origin = seedOf.get(pid);
    return pid !== rootPid && ((origin === rootPid && rootAlive) || (origin !== undefined && (retainedSet.has(origin) || markedSet.has(origin))) || (marker !== undefined && hasMatchingMarkerInProc(pid, marker, procRoot)));
  });
  const retained = retainedDescendants.get(proc) ?? new Map<number, string>();
  for (const pid of ownedPids) {
    if (!retained.has(pid) || retained.get(pid) === '') {
      const fp = readPidFingerprint(pid, procRoot);
      if (fp !== undefined) retained.set(pid, fp ?? '');
    }
  }
  if (retained.size > 0) retainedDescendants.set(proc, retained);
  else retainedDescendants.delete(proc);
  if (procRoot !== '/proc') return { waitPids: ownedPids, signalError: unverifiedError };
  const waitPids: number[] = [];
  let signalError: Error | undefined = unverifiedError;
  for (const pid of ownedPids) {
    const err = signalDescendantPid(pid);
    if (err === undefined) waitPids.push(pid);
    else if (signalError === undefined) signalError = markUnconfirmedDescendants(err);
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
    const toErr = (e: unknown): Error => markUnconfirmedDescendants(e instanceof Error ? e : new Error('SIGKILL_FAILED'));
    try {
      return killProcessTree(child)?.catch((e: unknown) => { throw toErr(e); });
    } catch (error) {
      return Promise.reject(toErr(error));
    }
  });
  const { waitPids, signalError } = terminateOwnedDescendants(proc);
  killLaunchProcessGroup(proc);
  const rootWait = safeKillSingle(proc);
  const waits: Array<Promise<void>> = childTree.filter((item): item is Promise<void> => item !== undefined);
  const waitTargets = waitPids.map((pid) => [pid, retainedDescendants.get(proc)?.get(pid) ?? ''] as const);
  if (waitTargets.length > 0) {
    waits.push(waitForPidsExit(waitTargets).then(() => {
      const retained = retainedDescendants.get(proc);
      if (retained === undefined) return;
      for (const [pid] of waitTargets) retained.delete(pid);
      if (retained.size === 0) retainedDescendants.delete(proc);
    }));
  }
  if (signalError !== undefined) waits.push(Promise.reject(signalError));
  if (rootWait === undefined && waits.length === 0) return undefined;
  const all = rootWait === undefined ? waits : [rootWait, ...waits];
  return Promise.allSettled(all).then((results) => {
    const rejected = results.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
    const chosen = rejected.find((item) => hasUnconfirmedDescendants(item.reason)) ?? rejected[0];
    if (chosen !== undefined) throw chosen.reason;
  });
}
