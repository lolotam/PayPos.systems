/**
 * One dependency `/ready` must reach. `/health` never runs these — it only says the process is alive.
 */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

const TIMEOUT_MS = 2_000;

/**
 * Wraps a check so each dependency has at most one probe outstanding, bounded by the timeout. Every caller
 * shares the same bounded promise, so a stalled dependency never collects one pending reaction per /ready
 * call; while the stalled operation is still running, callers get its already-settled timeout failure.
 *
 * @param check the dependency check
 * @returns the same check, sharing one bounded in-flight probe
 */
export function singleFlight(check: ReadinessCheck): ReadinessCheck {
  let bounded: Promise<void> | undefined;
  return {
    name: check.name,
    check: () => {
      if (bounded === undefined) {
        const underlying = check.check();
        bounded = within(underlying, TIMEOUT_MS);
        // Suppress the unhandled rejection on the shared promise; each caller still sees its outcome.
        bounded.catch(() => undefined);
        void underlying
          .catch(() => undefined)
          .finally(() => {
            bounded = undefined;
          });
      }
      return bounded;
    },
  };
}

// A dependency that hangs must not hang /ready: an orchestrator polls it and needs a prompt answer.
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs every check in parallel, each bounded by a timeout, and reports each one as up or down.
 *
 * @param checks the dependencies to probe
 * @returns `ok` only when every check passed, with the state of each
 */
export async function probe(
  checks: readonly ReadinessCheck[],
): Promise<{ ok: boolean; checks: Record<string, 'up' | 'down'> }> {
  const results = await Promise.all(
    checks.map(async ({ name, check }) => {
      try {
        await check();
        return [name, 'up'] as const;
      } catch {
        return [name, 'down'] as const;
      }
    }),
  );
  return {
    ok: results.every(([, state]) => state === 'up'),
    checks: Object.fromEntries(results),
  };
}
