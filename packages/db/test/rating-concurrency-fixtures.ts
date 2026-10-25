import type postgres from 'postgres';

/**
 * بوابة بتفتح بإيد واحد؛ الاختبار بيستخدمها عشان يمسك transaction مفتوحة لحد ما يتأكد إن التانية مستنية.
 */
export interface Gate {
  /** بتفتح البوابة؛ الـ promise بتخلص بعدها. */
  open(): void;
  /** الـ promise اللي بيخلص لما البوابة تفتح. */
  readonly opened: Promise<void>;
}

export function createGate(): Gate {
  let release: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    release = () => resolve(undefined);
  });
  return { open: () => release(), opened };
}

/**
 * بيستنى لحد ما session من الـ app تقف على قفل صف؛ الدليل من pg_stat_activity والانتظار محدود بخمس ثواني.
 */
export async function waitForBlockedAppSession(
  owner: postgres.Sql,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // الفاصل جزء من القراءة نفسها: بينزود الـ poll من غير ما يستنى حدث معروف.
    const rows = await owner<{ blocked: number }[]>`
      SELECT (SELECT count(*)::int FROM pg_stat_activity
               WHERE datname = current_database() AND usename = 'pospay_app'
                 AND state = 'active' AND wait_event_type = 'Lock') AS blocked,
             pg_sleep(0.05) AS pause`;
    if ((rows[0]?.blocked ?? 0) > 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        'the second rating transaction never blocked on the row lock of the first one',
      );
    }
  }
}
