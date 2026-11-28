import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

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
const PID_POLL_MS = 10;
export const LAUNCH_MARKER_ENV = 'POSPAY_CHROMIUM_LAUNCH_ID';

function errorWithCleanup(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'DOCUMENT_LAUNCH_FAILED');
}

/** يربط وعد تنظيف Chromium المتروك بخطأ الإطلاق عشان المُصيّر يقفل البوابة لحين انتهاء القتل. */
export function withLaunchCleanup(error: unknown, cleanup: Promise<void>): Error {
  const wrapped = errorWithCleanup(error);
  Object.defineProperty(wrapped, CLEANUP_KEY, { value: cleanup, enumerable: false, configurable: true });
  return wrapped;
}

/** يقرأ وعد تنظيف Chromium المرتبط بخطأ إطلاق بعد تفرّع العملية إن وُجد. */
export function getLaunchCleanup(error: unknown): Promise<void> | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const value = (error as Record<symbol, unknown>)[CLEANUP_KEY];
  return value instanceof Promise ? (value as Promise<void>) : undefined;
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

function hasLaunchMarker(pid: number, marker: string, procRoot: string): boolean {
  try {
    const stat = readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    if (isLinuxStatZombie(stat)) return false;
    const envText = readFileSync(`${procRoot}/${pid}/environ`, 'utf8');
    return envText.split('\0').includes(marker);
  } catch {
    return false;
  }
}

/** يستخرج PIDs التابعة لإطلاق فاشل بعد التحقق من وسم البيئة لمنع إرسال إشارة لرقم عملية أُعيد تدويره. */
export function extractLaunchedPids(error: unknown, launchMarker?: string, procRoot = '/proc'): number[] {
  if (launchMarker === undefined || (process.platform !== 'linux' && procRoot === '/proc')) {
    return [];
  }
  const marker = `${LAUNCH_MARKER_ENV}=${launchMarker}`;
  const candidates = new Set<number>();
  if (error instanceof Error) {
    for (const match of error.message.matchAll(/<launched>\s+pid=(\d+)/g)) {
      const pid = Number(match[1]);
      if (Number.isInteger(pid) && pid > 0) candidates.add(pid);
    }
  }
  for (const row of readLinuxProcessPairs(procRoot)) {
    candidates.add(row.pid);
  }
  return [...candidates].filter((pid) => hasLaunchMarker(pid, marker, procRoot));
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

function killPidSafely(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ESRCH يعني خرجت بالفعل؛ تجاهلها وانتظر التحقق.
  }
}

/** يقتل PIDs التابعة لإطلاق فاشل وشجرتها وينتظر خروجها الفعلي (بما فيها حالات الزومبي). */
export async function killPidsAndWait(pids: readonly number[]): Promise<void> {
  const all = [...new Set([...collectDescendantPids(pids), ...pids])];
  for (const pid of all) killPidSafely(pid);
  while (all.some((pid) => isPidAlive(pid))) {
    await new Promise((resolve) => setTimeout(resolve, PID_POLL_MS));
  }
}

function killSingleAndWait(proc: KillableProcess): Promise<void> | void {
  if (hasExited(proc)) return Promise.resolve();
  const once = proc.once;
  if (typeof once !== 'function') {
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

/** يقتل عملية Chromium الجذر وكل شجرة توابعها قبل فكّ قفل إعادة الإطلاق. */
export function killProcessTree(proc: KillableProcess): Promise<void> | void {
  const childTree = (proc.children ?? []).map((child) => killProcessTree(child));
  const osDescendants = typeof proc.pid === 'number' && proc.pid > 0 ? collectDescendantPids([proc.pid]) : [];
  for (const pid of osDescendants) killPidSafely(pid);
  const rootWait = killSingleAndWait(proc);
  const waits: Array<Promise<void>> = childTree.filter((item): item is Promise<void> => item !== undefined);
  if (osDescendants.length > 0) {
    waits.push(
      (async () => {
        while (osDescendants.some((pid) => isPidAlive(pid))) {
          await new Promise((resolve) => setTimeout(resolve, PID_POLL_MS));
        }
      })(),
    );
  }
  if (rootWait === undefined && waits.length === 0) return undefined;
  return Promise.all([rootWait, ...waits]).then(() => undefined);
}
