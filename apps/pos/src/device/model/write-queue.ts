let chain: Promise<void> = Promise.resolve();

// الكتابة بتتسلسل عشان مسح «البدء من جديد» ما يسبقوش حفظ نتيجة المطالبة ويرجّعها.
export function enqueueWrite<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
