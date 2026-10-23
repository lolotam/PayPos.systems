import type postgres from 'postgres';

/**
 * استعلامات اختبار الدفع: محاولات الدفع وأحداث الإذن وصفوف الجرس ومحاولات الهاتف.
 * القاعدة: القراءة من اتصال المالك (مالك الداتابيز) عشان التطبيق نفسه مالوش صلاحية قراءة جداول جديدة.
 *
 * @param owner اتصال المالك
 * @returns استعلامات القراءة المستخدمة في اختبار المستهلك
 */
export function pushQueries(owner: postgres.Sql) {
  return {
    attempts: (sourceEventId: string) =>
      owner`SELECT * FROM push_attempts WHERE source_event_id = ${sourceEventId} ORDER BY id`,
    authorized: (sourceEventId: string) => owner`SELECT o.event_type, o.payload FROM outbox o
      JOIN push_attempts a ON a.company_id = o.company_id AND a.id = (o.payload->>'attempt_id')::uuid
      WHERE a.source_event_id = ${sourceEventId} ORDER BY o.id`,
    inbox: (sourceEventId: string) =>
      owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${sourceEventId}`,
    phoneAttempts: (sourceEventId: string) =>
      owner`SELECT id FROM notification_attempts WHERE source_event_id = ${sourceEventId}`,
  };
}
