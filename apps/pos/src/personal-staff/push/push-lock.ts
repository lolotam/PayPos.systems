// قفل واحد لكل عمليات الإشعارات: القراءة والكتابة والاشتراك ما يتنافسوش مع بعض،
// عشان تسجيل قديم ما يكتبش فوق تسجيل جديد ولا تدوير يكمّل بعد إيقاف (ADR-0052 §7).

let chain: Promise<unknown> = Promise.resolve();

/** الطابور البديل للمتصفحات من غير Web Locks: شغل واحد في كل مرة، والفشل ما بيقفش اللي بعده. */
function runInQueue<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * بيشغّل شغل الإشعارات من غير ما يتنافس مع شغل تاني على نفس الجهاز.
 *
 * @param work الشغل المطلوب
 * @returns نتيجته
 */
export function runPushExclusive<T>(work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks !== undefined) return locks.request('pospay-push', work);
  return runInQueue(work);
}
