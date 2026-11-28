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

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === 'EPERM';
  }
}

function directLinuxChildren(pid: number): number[] {
  const found = new Set<number>();
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      const text = readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').trim();
      for (const token of text.split(/\s+/)) {
        const child = Number(token);
        if (Number.isInteger(child) && child > 0) found.add(child);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}

function readProcessTablePairs(): Array<{ pid: number; ppid: number }> {
  if (process.platform === 'linux') {
    const rows: Array<{ pid: number; ppid: number }> = [];
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
        const closeParen = stat.lastIndexOf(')');
        if (closeParen === -1) continue;
        const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
        const ppid = Number(fields[1]);
        const pid = Number(entry);
        if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid > 0) {
          rows.push({ pid, ppid });
        }
      }
      return rows;
    } catch {
      return [];
    }
  }
  if (process.platform === 'darwin') {
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
  return [];
}

/** يلتقط أرقام العمليات التابعة المباشرة للعملية الحالية قبل الإطلاق على Linux/macOS. */
export function snapshotOwnChildPids(): ReadonlySet<number> {
  if (process.platform === 'linux') {
    const direct = directLinuxChildren(process.pid);
    if (direct.length > 0) return new Set(direct);
  }
  const rows = readProcessTablePairs();
  return new Set(rows.filter((r) => r.ppid === process.pid).map((r) => r.pid));
}

function collectDescendantPids(rootPids: readonly number[]): number[] {
  const result: number[] = [];
  const seen = new Set<number>(rootPids);
  const queue = [...rootPids];
  const table = process.platform === 'linux' ? null : readProcessTablePairs();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const children =
      process.platform === 'linux'
        ? directLinuxChildren(current)
        : (table ?? []).filter((row) => row.ppid === current).map((row) => row.pid);
    for (const child of children) {
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

/** يقتل مجموعة PIDs وتوابعها وينتظر خروجها من نظام التشغيل. */
export async function killPidsAndWait(pids: readonly number[]): Promise<void> {
  const all = [...new Set([...collectDescendantPids(pids), ...pids])];
  for (const pid of all) killPidSafely(pid);
  while (all.some(isPidAlive)) {
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
        while (osDescendants.some(isPidAlive)) {
          await new Promise((resolve) => setTimeout(resolve, PID_POLL_MS));
        }
      })(),
    );
  }
  if (rootWait === undefined && waits.length === 0) return undefined;
  return Promise.all([rootWait, ...waits]).then(() => undefined);
}
