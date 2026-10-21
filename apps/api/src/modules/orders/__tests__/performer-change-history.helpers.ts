import { applyChange, performer, type ChangeCtx, type Person } from '../../../../../../packages/db/test/service-line-performer-change.ts';
import { ids, must, type SessionFixture } from './session.fixture.ts';

export type PerformerChangePlan = {
  revision: number;
  before: Person[];
  after: Person[];
  reason: string;
  changerNameAr?: string | null;
  changerNameEn?: string | null;
  changerRole?: string | null;
  roleIsSystem?: boolean | null;
  roleNameEn?: string | null;
};

/** عضوية المالك في الشركة: رأس التغيير لازم يشير لعضوية مستخدم حقيقي. */
export async function ownerMembershipOf(f: SessionFixture): Promise<string> {
  const [membership] = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${f.ownerId}`;
  return String(must(membership)['id']);
}

/** سياق الكتابة: السطر هو مرساة التغيير، والخدمة بتقرأ من السطر نفسه. */
export async function changeContext(f: SessionFixture, sessionId: string, lineId: string, membershipId: string): Promise<ChangeCtx> {
  const [row] = await f.h.owner`SELECT service_id FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  return { company: f.company, business: f.business, branch: f.branch, userId: f.ownerId, membershipId, sessionId,
    serviceId: String(must(row)['service_id']) };
}

/** الصفوف الحيّة للسطر: جانب BEFORE لازم يطابقها حقلاً حقلاً. */
export async function livePeople(f: SessionFixture, lineId: string): Promise<Person[]> {
  const rows = await f.h.owner`SELECT employee_id, performer_ordinal, share_bps, linked_user_id, linked_user_snapshotted,
    name_en, name_ar, not_clocked_in_warning, approved_leave_warning
    FROM line_performers WHERE company_id=${f.company} AND line_id=${lineId} ORDER BY performer_ordinal`;
  return rows.map((row) => performer(String(row['employee_id']), {
    ordinal: Number(row['performer_ordinal']), share: Number(row['share_bps']),
    userId: textOrNull(row['linked_user_id']), nameEn: String(row['name_en']), nameAr: textOrNull(row['name_ar']),
    snapshotted: row['linked_user_snapshotted'] === true, clock: row['not_clocked_in_warning'] === true,
    leave: row['approved_leave_warning'] === true,
  }));
}

export async function employeePerson(f: SessionFixture, employeeId: string): Promise<Person> {
  const [row] = await f.h.owner`SELECT name_en, name_ar, user_id FROM employees WHERE company_id=${f.company} AND id=${employeeId}`;
  const employee = must(row);
  return performer(employeeId, { userId: textOrNull(employee['user_id']), nameEn: String(employee['name_en']),
    nameAr: textOrNull(employee['name_ar']), snapshotted: true });
}

export function withShare(person: Person, ordinal: number, share: number): Person {
  return performer(person.employeeId, { ordinal, share, userId: person.userId, nameEn: person.nameEn,
    nameAr: person.nameAr, snapshotted: person.snapshotted, clock: person.clock, leave: person.leave });
}

// كل تغيير في معاملاته لوحده: القاعدة ترفض تغييرين لنفس السطر في نفس المعاملة.
// حقول لقطة اللي غيّر المنفّذين بتتبعت كاملة: الغايب منها يعني null (مفيش اسم ولا دور)، والقاعدة بتقبل الاسم أو الدور.
export async function commitPerformerChange(f: SessionFixture, ctx: ChangeCtx, lineId: string, plan: PerformerChangePlan) {
  await f.db.withTenant(f.company, (tx) => applyChange(tx, ctx, ids, {
    lineId, previous: plan.revision - 1, revision: plan.revision,
    before: plan.before, live: plan.after, after: plan.after, reason: plan.reason,
    warning: plan.after.some((person) => person.clock || person.leave),
    changerNameAr: plan.changerNameAr ?? null, changerNameEn: plan.changerNameEn ?? null,
    changerRole: plan.changerRole ?? null, roleIsSystem: plan.roleIsSystem ?? null,
    roleNameAr: null, roleNameEn: plan.roleNameEn ?? null,
  }), { userId: f.ownerId });
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
