import { describe, it } from 'vitest';

// ما بقي من هيكل اختبارات 53-2 بعد اختبارات PR A (use case، HTTP، العدّاد، المرحّلات، الأجسام الفرعية في packages/db).
// كل بند `it.todo` يحمل رقم الصف في الـ spec 059 §7 واسمه، ولا يُمحى حتى يُنفَّذ. بنود التنبيه والمشغّل في PR B.

describe('approve-statement: still open after PR A', () => {
  it.todo('CM-34: a failure while freezing rolls back lines, fingerprint, status and audit (needs a fault-injecting writer)');
  it.todo('CM-34c: an empty month freezes two EMPLOYEE rows with amount 0 and nothing else, and an employee hired in November is not listed');
  it.todo('CM-34d: a transferred employee gets two clipped attachment rows, attached_branch_ids equals them, and a later EmployeeBranch edit changes none of them');
  it.todo('CM-34d: a correction received by November freezes with previous_amount, new_amount and the delta');
  it.todo('CM-38b: branch grants covering every branch of a two-branch business are refused with the uniform 403');
  it.todo('ADR-0012 group 5: a consumer rollback leaves its event pending, a committed effect and mark discharges it (worker side)');
  // سباقات ADR-0054 §10 اختبار 6 التي تنتقل إلى PR B حيث يعيش الإصدار (مذكورة في وصف PR A تحت «Not proven in this PR»).
  it.todo('PR B: an invalidation racing an approval: the approval holds the state row FOR SHARE, the invalidator waits or the approval waits and then refuses');
  it.todo('PR B: an issuance racing an approval: the issue function waits on the share lock and the approval never sees a half-issued proof');
  it.todo('PR B: an issue racing an invalidation: one of them commits first and the other applies to the locked value');
  it.todo('PR B: two concurrent invalidators both succeed, each bump applied to the locked value');
  it.todo('PR B: a release migration against an in-flight approval on a row its statement saw, in both orders');
});
