// قفل واحد لكل عمليات الإشعارات: القراءة والكتابة والاشتراك ما يتنافسوش مع بعض،
// عشان تسجيل قديم ما يكتبش فوق تسجيل جديد ولا تدوير يكمّل بعد إيقاف (ADR-0052 §7).

let chain: Promise<unknown> = Promise.resolve();
let generation = 0;

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
 * رقم جيل السجل: كل كتابة بتاخد رقمها وقت ما تشتغل، وتكتب بس لو الرقم لسه هو نفسه.
 * كده الخروج الصريح بيكسر أي شغل شغال ويخليه ما يكتبش تاني (ADR-0052 §7).
 *
 * @returns رقم الجيل الحالي
 */
export function currentPushGeneration(): number {
  return generation;
}

/**
 * بيكسر جيل السجل: الشغل اللي شغال دلوقتي بيمسك نفسه وما يكتبش بعد كده.
 *
 * @returns رقم الجيل الجديد
 */
export function bumpPushGeneration(): number {
  generation += 1;
  return generation;
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
