import { describe, it } from 'vitest';

// ما بقي من هيكل اختبارات 53-2 بعد اختبارات PR A (use case، HTTP، العدّاد، المرحّلات، الأجسام الفرعية في packages/db).
// كل بند `it.todo` يحمل رقم الصف في الـ spec 059 §7 واسمه، ولا يُمحى حتى يُنفَّذ. بنود التنبيه والمشغّل في PR B.

describe('approve-statement: not proven in PR A', () => {
  it.todo('ADR-0012 group 5: a consumer rollback leaves its event pending, a committed effect and mark discharges it (worker side)');
  // سباقات ADR-0054 §10 اختبار 6 التي تنتقل إلى PR B حيث يعيش الإصدار (مذكورة في وصف PR A تحت «Not proven in this PR»).
  it.todo('PR B: an invalidation racing an approval: the approval holds the state row FOR SHARE, the invalidator waits or the approval waits and then refuses');
  it.todo('PR B: an issuance racing an approval: the issue function waits on the share lock and the approval never sees a half-issued proof');
  it.todo('PR B: an issue racing an invalidation: one of them commits first and the other applies to the locked value');
  it.todo('PR B: two concurrent invalidators both succeed, each bump applied to the locked value');
  it.todo('PR B: a release migration against an in-flight approval on a row its statement saw, in both orders');
});
