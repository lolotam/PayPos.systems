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
 * Wraps a check so at most one probe per dependency is ever outstanding. A stalled dependency makes each
 * /ready return after the timeout while its ping stays pending; without this, every request would start
 * another ping and pile up connections and queued commands.
 *
 * @param check the dependency check
 * @returns the same check, sharing one in-flight probe between concurrent and repeated callers
 */
export function singleFlight(check: ReadinessCheck): ReadinessCheck {
  let inFlight: Promise<void> | undefined;
  return {
    name: check.name,
    check: () => {
      inFlight ??= check.check().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
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
        await within(check(), TIMEOUT_MS);
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
