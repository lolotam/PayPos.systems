import {
  missedOutAction,
  missedOutCandidateCutoff,
  missedOutDeadline,
  suspectedMissedOutDueAt,
  type MissedOutAction,
  type MissedOutSession,
} from '../../domain/missed-out.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { MissedOutCursor, MissedOutTransactions } from '../../ports/missed-out.port.ts';

// TODO(spec) MO-Q2: حجم الصفحة غير محسوم؛ ١٠٠ مرشح لكل قراءة وكل الصفحات في الدورة (موصى به).
export const MISSED_OUT_PAGE_SIZE = 100;

/** ما فعلته دورة واحدة لشركة واحدة؛ يكفي للاختبار ولا يحمل بيانات موظف. */
export interface MissedOutRun {
  suspected: number;
  missedOut: number;
}

/** يكتشف نسيان الخروج لشركة واحدة: اشتباه عند استحقاقه وMISSED_OUT عند ١٦ ساعة، تحت قفل State لكل موظف. */
export class DetectMissedOuts {
  constructor(
    private readonly transactions: MissedOutTransactions,
    private readonly clock: Clock,
  ) {}
  async execute(companyId: string): Promise<MissedOutRun> {
    const run: MissedOutRun = { suspected: 0, missedOut: 0 };
    let failed = 0;
    let after: MissedOutCursor | null = null;
    for (;;) {
      const now = this.clock.now();
      const page = await this.transactions.candidates(
        companyId,
        missedOutCandidateCutoff(now),
        after,
        MISSED_OUT_PAGE_SIZE,
      );
      // القراءة بلا قفل فرز فقط؛ القرار الملزم يعاد تحت القفل بلحظة جديدة.
      for (const candidate of page.filter((s) => missedOutAction(s, now) !== 'NONE')) {
        const action = await this.settle(companyId, candidate).catch(() => null);
        if (action === null) failed++;
        else if (action === 'RAISE_SUSPECTED') run.suspected++;
        else if (action === 'CLOSE_MISSED_OUT') run.missedOut++;
      }
      const last = page.at(-1);
      if (page.length < MISSED_OUT_PAGE_SIZE || last === undefined) break;
      after = { clockIn: last.clockIn, id: last.id };
    }
    // موظف فشلت معاملته لا يوقف الباقين؛ الفشل يعيد المهمة كلها وهي idempotent تحت القفل.
    if (failed > 0) throw new Error('ATTENDANCE_MISSED_OUT_RETRY');
    return run;
  }
  private settle(companyId: string, candidate: MissedOutSession): Promise<MissedOutAction> {
    return this.transactions.run(
      companyId,
      candidate.employeeId,
      () => this.clock.now(),
      async (tx, at) => {
        const open = tx.open;
        // المسح الذي سبق الوظيفة إلى القفل يكسب: جلسة مقفولة أو جلسة جديدة ليست مرشحتنا.
        if (open === null || open.id !== candidate.id) return 'NONE';
        const action = missedOutAction(open, at);
        if (action === 'RAISE_SUSPECTED')
          return (await tx.raiseSuspected(open, suspectedMissedOutDueAt(open), at))
            ? action
            : 'NONE';
        if (action === 'CLOSE_MISSED_OUT')
          return (await tx.closeMissedOut(open, missedOutDeadline(open.clockIn), at))
            ? action
            : 'NONE';
        return 'NONE';
      },
    );
  }
}
