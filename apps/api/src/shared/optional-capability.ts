const OPTIONAL_DEADLINE_MS = 1000;

// Composition-root work only: ordinary readiness does not wait for an optional capability.
export async function optionalWithin<T>(work: () => Promise<T>, ms = OPTIONAL_DEADLINE_MS) {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('OPTIONAL_CAPABILITY_TIMEOUT')), ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Every disposer starts, even if another throws; force-close is selected by the owning adapter.
export async function closeOptional(work: readonly (() => Promise<unknown> | undefined)[]) {
  await optionalWithin(() =>
    Promise.allSettled(work.map((close) => Promise.resolve().then(close))),
  ).catch(() => undefined);
}
