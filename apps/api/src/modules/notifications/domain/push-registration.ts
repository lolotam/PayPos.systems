/** صف اشتراك حيّ في الشركة: هوية صاحب الصف وبصمة تثبيته وبصمة وجهته. */
export interface LivePushRow {
  readonly id: string;
  readonly userId: string;
  readonly installationHash: string;
  readonly endpointHash: string;
  readonly createdAt: Date;
}

/** سبب سحب اشتراك: تغيّر المالك، أو تغيّر التثبيت، أو تجاوز حد الاشتراكات. */
export type PushRevocationReason = 'OWNER_CHANGED' | 'REPLACED' | 'CAP_EXCEEDED';

/** صف يتسحب مع سبب السحب. */
export interface PushRevocation {
  readonly id: string;
  readonly reason: PushRevocationReason;
}

/** القاعدة اللي بتقرر إيه يتسحب مع تسجيل جديد. */
export interface PushRegistrationPlan {
  readonly callerUserId: string;
  readonly installationHash: string;
  readonly endpointHash: string;
  readonly cap: number;
  readonly callerRows: readonly LivePushRow[];
  readonly endpointHolders: readonly LivePushRow[];
}

/** قرار السحب: الصفوف اللي لازم تتسحب قبل ما التسجيل الجديد يتحفظ. */
export interface PushRegistrationDecision {
  readonly revoke: readonly PushRevocation[];
}

/**
 * بيقرر إيه يتسحب قبل ما اشتراك جديد يتحفظ.
 * القاعدة: الوجهة الحيّة بتنتقل لصاحبها الجديد فصاحبها القديم يتسحب بـ OWNER_CHANGED، ونفس الشخص
 * بغيّر تثبيته فصفه القديم يتسحب بـ REPLACED، وبعدين صفوف صاحب الطلب اللي زادت عن الحد بتتسحب
 * بالأقدم أولاً بـ CAP_EXCEEDED. صف صاحب الطلب لنفس التثبيت ما بيتسحبش أبداً.
 *
 * @param input الصفوف الحيّة والحد وتثبيت الطلب ووجهته
 * @returns الصفوف المرشحة للسحب مع سبب كل واحد
 */
export function planPushRegistration(input: PushRegistrationPlan): PushRegistrationDecision {
  const revoke: PushRevocation[] = [];
  const revoked = new Set<string>();
  const holders = input.endpointHolders.filter(
    (row) => row.endpointHash === input.endpointHash,
  );
  for (const holder of holders) {
    if (holder.userId !== input.callerUserId) {
      revoke.push({ id: holder.id, reason: 'OWNER_CHANGED' });
      revoked.add(holder.id);
      continue;
    }
    if (holder.installationHash !== input.installationHash) {
      revoke.push({ id: holder.id, reason: 'REPLACED' });
      revoked.add(holder.id);
    }
  }
  const others = input.callerRows.filter(
    (row) => row.installationHash !== input.installationHash && !revoked.has(row.id),
  );
  let count = others.length;
  for (const row of [...others].sort(byAge)) {
    if (count < input.cap) break;
    revoke.push({ id: row.id, reason: 'CAP_EXCEEDED' });
    count -= 1;
  }
  return { revoke };
}

// الأقدم أولاً، وعند نفس الوقت الـ id الأصغر أولاً عشان النتيجة واحدة مهما كان ترتيب الصفوف.
function byAge(left: LivePushRow, right: LivePushRow): number {
  const at = left.createdAt.getTime() - right.createdAt.getTime();
  if (at !== 0) return at;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}
