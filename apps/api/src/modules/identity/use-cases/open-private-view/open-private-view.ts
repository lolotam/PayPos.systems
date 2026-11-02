import type { PrivateViewProof, PrivateViewScope, StaffSession } from '@pospay/auth';
import { STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import type { PinAttempts, PinTarget } from '../../ports/cashier-pins.port.ts';
import type { PrivateViewAuthority } from '../../ports/private-view.port.ts';
import type { StaffPinAuthority, StaffPinTransactions } from '../../ports/staff-pins.port.ts';

/** نافذة العرض الخاص المفتوحة؛ القيم بتتساوب مع اللي في العقد. */
export interface OpenPrivateViewOpened {
  readonly kind: 'opened';
  readonly windowId: string;
  readonly windowSeq: string;
  readonly sessionRef: string;
  readonly idleRemainingMs: number;
  readonly capRemainingMs: number;
}

/** الفتح مرفوض: PIN غلط، أو القفل، أو جلسة مش سارية. */
export interface OpenPrivateViewRefused {
  readonly kind: 'refused';
}

export type OpenPrivateViewResult = OpenPrivateViewOpened | OpenPrivateViewRefused;

class OpeningRefused extends Error {}

/** إثبات الـ PIN ومعه id سجل الاعتماد اللي اتقارن بيه. */
interface ProvenPin {
  readonly proof: PrivateViewProof;
  readonly revision: string;
}

/** يفتح نافذة العرض الخاص بعد PIN جديد، بنفس عدّاد محاولات دخول الموظف. */
export class OpenPrivateView {
  private active = 0;
  constructor(
    private readonly db: StaffPinTransactions,
    private readonly attempts: PinAttempts,
    private readonly authority: Pick<StaffPinAuthority, 'eligible' | 'deviceValid'>,
    private readonly privateView: PrivateViewAuthority,
  ) {}

  /**
   * @param input الـ PIN الجديد وجلسة الموظف المثبتة على الجهاز
   * @returns النافذة المفتوحة أو رفض
   */
  async execute(input: { pin: string; session: StaffSession }): Promise<OpenPrivateViewResult> {
    if (this.active >= STAFF_LOGIN_CONCURRENCY) throw new Error('STAFF_PIN_UNAVAILABLE');
    this.active++;
    try {
      return await this.open(input);
    } finally {
      this.active--;
    }
  }

  private async open(input: {
    pin: string;
    session: StaffSession;
  }): Promise<OpenPrivateViewResult> {
    const session = input.session;
    const scope: PrivateViewScope = {
      sessionId: session.sessionId,
      userId: session.userId,
      deviceId: session.context.deviceId,
    };
    // نفس عدّاد PIN الدخول: محاولة فتح نافذة غلط بتحسب زي محاولة دخول غلط.
    const target: PinTarget = {
      companyId: session.context.companyId,
      employeeId: `staff-user:${session.userId}`,
    };
    const reservation = await this.attempts.reserve(target);
    if (reservation.kind !== 'ok') {
      // مقارنة واحدة مستهلكة عشان القفل ما يردّ أسرع من PIN غلط.
      await this.privateView.provePin({ pin: input.pin, hash: null, scope });
      return { kind: 'refused' };
    }
    const proven = await this.prove(input.pin, session, scope, target, reservation.reservation);
    if (proven === null) return { kind: 'refused' };
    return this.finish(proven, session, scope);
  }

  private async prove(
    pin: string,
    session: StaffSession,
    scope: PrivateViewScope,
    target: PinTarget,
    reservation: string,
  ): Promise<ProvenPin | null> {
    let proof: PrivateViewProof | null;
    let revision: string | null;
    try {
      const row = await this.db.run(session.context.companyId, null, (read) =>
        read.find(session.userId),
      );
      revision = row?.id ?? null;
      proof = await this.privateView.provePin({ pin, hash: row?.hash ?? null, scope });
    } catch (error) {
      await this.attempts.release(target, reservation);
      throw error;
    }
    if (proof === null || revision === null) {
      await this.attempts.failed(target, reservation);
      return null;
    }
    if ((await this.attempts.succeeded(target, reservation)) !== 'ok') return null;
    return { proof, revision };
  }

  private async finish(
    { proof, revision }: ProvenPin,
    session: StaffSession,
    scope: PrivateViewScope,
  ): Promise<OpenPrivateViewResult> {
    // إعادة التأهل قبل الفتح: عضوية أو جهاز اتغيّروا بعد الجلسة، فالنافذة ما تفتحش.
    if (!(await this.authority.eligible(session.userId, session.context)))
      return { kind: 'refused' };
    if (!(await this.authority.deviceValid(session.context))) return { kind: 'refused' };
    const opened: { value: OpenPrivateViewOpened | null } = { value: null };
    // مخزن النافذة وPostgres ما يشاركوش معاملة واحدة، فسطر التدقيق أولاً وفشل الـ commit يقفل النافذة عشان مفيش نافذة تعيش بلا سطر تدقيقها.
    try {
      await this.db.run(session.context.companyId, session.userId, async (read) => {
        // إعادة تعيين الـ PIN أثناء المقارنة بتغيّر id السجل؛ المقارنة على اعتماد ملغى ما تفتحش نافذة.
        if ((await read.find(session.userId))?.id !== revision) throw new OpeningRefused();
        await read.audit.record({
          entity: 'cashier_pin',
          entityId: session.userId,
          action: 'staff.private_view_opened',
        });
        const opening = await this.privateView.open({ proof, scope, device: session.context });
        if (opening.kind !== 'opened') throw new OpeningRefused();
        opened.value = {
          kind: 'opened',
          windowId: opening.windowId,
          windowSeq: opening.windowSeq,
          sessionRef: opening.sessionRef,
          idleRemainingMs: opening.idleRemainingMs,
          capRemainingMs: opening.capRemainingMs,
        };
      });
      return opened.value ?? { kind: 'refused' };
    } catch (error) {
      if (error instanceof OpeningRefused) return { kind: 'refused' };
      if (opened.value !== null) {
        try {
          await this.privateView.close(scope, opened.value.windowId);
        } catch {
          // فشل القفل ما يسترش خطأ الـ commit الأصلي.
        }
      }
      throw error;
    }
  }
}
