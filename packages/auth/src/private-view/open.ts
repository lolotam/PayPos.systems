import { openStaffPrivateView, type StaffPrivateViewSessionRow } from '@pospay/db';
import { sameDevice } from '../staff-otp/policy.ts';
import type { StaffDeviceContext } from '../staff-otp/types.ts';
import {
  consumePrivateViewProof,
  samePrivateViewScope,
  type PrivateViewProof,
  type PrivateViewScope,
} from './proof.ts';
import {
  PRIVATE_VIEW_CAP_MS,
  PRIVATE_VIEW_IDLE_MS,
  type PrivateViewStoreOptions,
} from './options.ts';

export interface PrivateViewOpenInput {
  readonly proof: PrivateViewProof;
  readonly scope: PrivateViewScope;
  readonly device: StaffDeviceContext;
}

export interface PrivateViewOpened {
  readonly kind: 'opened';
  readonly windowId: string;
  readonly windowSeq: string;
  readonly sessionRef: string;
  readonly idleRemainingMs: number;
  readonly capRemainingMs: number;
}

export interface PrivateViewRefused {
  readonly kind: 'refused';
  readonly reason: 'proof' | 'session';
}

export type PrivateViewOpenResult = PrivateViewOpened | PrivateViewRefused;

type ProofState = NonNullable<ReturnType<typeof consumePrivateViewProof>>;

/**
 * يفتح نافذة واحدة للجلسة بترتيب قفل يمنع تزامن الفتح من ترك صفين أو إعادة صف بعد إنهائها.
 *
 * @param options اتصال الاعتماد والساعة والمعرفات والعشوائية المحقونة
 * @param input دليل PIN ونطاق الفتح وسياق الجهاز المثبت
 * @returns النافذة الجديدة وترتيبها ومدتاها، أو رفضاً يميز الدليل من الجلسة
 */
export async function openPrivateView(
  options: PrivateViewStoreOptions,
  input: PrivateViewOpenInput,
): Promise<PrivateViewOpenResult> {
  const proof = consumePrivateViewProof(input.proof);
  if (proof === null || !samePrivateViewScope(proof.scope, input.scope)) {
    return { kind: 'refused', reason: 'proof' };
  }
  const windowId = Buffer.from(options.entropy.bytes(16)).toString('base64url');
  let reason: 'proof' | 'session' = 'session';
  const outcome = await openStaffPrivateView(options.database, {
    sessionId: input.scope.sessionId,
    userId: input.scope.userId,
    deviceId: input.scope.deviceId,
    windowId,
    windowRowId: options.ids.newId(),
    counterRowId: options.ids.newId(),
    accept: (row) => {
      // العينة بتاخد هنا جوه القفل: الفتح اللي استنى قفل Sign-out يتقاس بوقته هو، مش بوقت الطلب.
      const now = options.now();
      if (!proofFresh(proof, now)) {
        reason = 'proof';
        return null;
      }
      if (!sessionLive(row, input, now)) {
        reason = 'session';
        return null;
      }
      return { now, expiresAt: new Date(now.getTime() + PRIVATE_VIEW_CAP_MS) };
    },
  });
  if (outcome.kind === 'refused') return { kind: 'refused', reason };
  const elapsedMs = outcome.now.getTime() - outcome.createdAt.getTime();
  const capRemainingMs = PRIVATE_VIEW_CAP_MS - elapsedMs;
  return {
    kind: 'opened',
    windowId,
    windowSeq: outcome.windowSeq,
    sessionRef: input.scope.sessionId,
    idleRemainingMs: Math.min(PRIVATE_VIEW_IDLE_MS, capRemainingMs),
    capRemainingMs,
  };
}

/**
 * عمر الدليل ستين ثانية بالكتير؛ بعد كده الدليل مش دليل.
 *
 * @param proof حالة الدليل المصروفة
 * @param now عينة الساعة اللي اتقارن بيها
 * @returns true طول ما الفرق بين الصفر وستين ثانية
 */
function proofFresh(proof: ProofState, now: Date): boolean {
  const age = now.getTime() - proof.verifiedAtMs;
  return age >= 0 && age <= PRIVATE_VIEW_IDLE_MS;
}

/**
 * يتأكد إن صف الجلسة هو جلسة الطلب نفسها: نفس الغاية، ونفس المشغل، ونفس الجهاز، وموعدها لسه قدام.
 *
 * @param session الصف المقفل أو null لما الصف يكون مش موجود
 * @param input نطاق الفتح وسياق الجهاز المثبت
 * @param now عينة الساعة اللي اتقارن بيها
 * @returns true طول ما الصف يطابق الطلب
 */
function sessionLive(
  session: StaffPrivateViewSessionRow | null,
  input: PrivateViewOpenInput,
  now: Date,
): boolean {
  if (
    session === null ||
    session.user_id !== input.scope.userId ||
    session.purpose !== 'STAFF_POS' ||
    session.staff_absolute_deadline === null ||
    session.staff_device_context === null ||
    typeof session.staff_device_context !== 'object'
  ) {
    return false;
  }
  const device = session.staff_device_context as StaffDeviceContext;
  return (
    sameDevice(device, input.device) &&
    now.getTime() < new Date(session.staff_absolute_deadline).getTime()
  );
}
