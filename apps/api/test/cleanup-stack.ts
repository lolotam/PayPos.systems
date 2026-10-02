/** يحفظ موارد setup الجزئي، ويصرفها بالعكس حتى لو فشل إغلاق مورد. */
export function cleanupStack() {
  const releases: (() => Promise<unknown>)[] = [];
  let closing: Promise<void> | undefined;
  return {
    own: <T>(resource: T, release: (value: T) => Promise<unknown>): T => {
      releases.push(() => release(resource));
      return resource;
    },
    close: () => (closing ??= closeAll(releases)),
  };
}

async function closeAll(releases: readonly (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const release of [...releases].reverse()) {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length !== 0) throw new AggregateError(failures, 'Test resources could not close');
}
