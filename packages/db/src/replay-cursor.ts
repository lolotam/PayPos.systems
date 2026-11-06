/** نطاق replay غير صالح؛ رمز ثابت بلا قيم المؤشرات أو بيانات الاتصال. */
export class ReplayCursorError extends Error {
  readonly code = 'REPLAY_SCOPE_INVALID';
  constructor() {
    super('REPLAY_SCOPE_INVALID');
  }
}

/** يرفض UUID مشوهًا أو حدًا أدنى بعد الأعلى؛ التساوي يعني نهاية نطاق صحيحة. */
export function assertReplayBounds(afterId: string | null, throughId: string | null): void {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (
    (afterId !== null && !uuid.test(afterId)) ||
    (throughId !== null && !uuid.test(throughId)) ||
    (afterId !== null && throughId !== null && afterId.toLowerCase() > throughId.toLowerCase())
  )
    throw new ReplayCursorError();
}
