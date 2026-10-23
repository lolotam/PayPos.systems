import { SYSTEM_ROLES } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { ordersLineEdits } from '../src/modules/orders/orders.module.ts';
import { EditServiceLinePriceUseCase } from '../src/modules/orders/use-cases/edit-service-line-price/edit-service-line-price.usecase.ts';
import { ids, must, sessionFixture, type SessionFixture } from './service-session.fixture.ts';
import { takeTestEmployeeNumber } from './test-employee-number.ts';

export interface PerformerSnapshot {
  employee_id: string;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
}

/** طبقة اختيارية فوق sessionFixture: مستخدم التعديل وساعته المشتركة مع setAt. */
export async function editFixture(options: Parameters<typeof sessionFixture>[0] = {}) {
  const base = await sessionFixture(options);
  const editor = await sessionEditor(base);
  const edit = new EditServiceLinePriceUseCase(ordersLineEdits(base.db), ids, base.clock);
  return {
    ...base,
    ...editor,
    edit,
    context: editContext(base),
    linkEmployee: (employeeId: string, linkedUser: string | null) =>
      base.h.owner`UPDATE employees SET user_id=${linkedUser} WHERE company_id=${base.company} AND id=${employeeId}`,
    snapshotPerformers: (lineId: string, rows: PerformerSnapshot[]) => applyPerformerSnapshot(base, lineId, rows),
  };
}

export type EditFixture = Awaited<ReturnType<typeof editFixture>>;

function editContext(base: SessionFixture) {
  return (key = ids.newId(), actor = base.userId, fingerprint = 'a'.repeat(64)) => ({
    companyId: base.company,
    userId: actor,
    businessId: base.business,
    branchId: base.branch,
    key,
    fingerprint,
  });
}

async function sessionEditor(base: SessionFixture) {
  const editorCookie = await base.h.signedInOperator('session-editor@example.test');
  const users = await base.h.owner`SELECT id FROM "user" WHERE email='session-editor@example.test'`;
  const editorId = must(users[0])['id'] as string;
  const editorMembership = ids.newId();
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'branch_manager')).id;
  const nameEn = 'Layla Editor';
  const nameAr = 'ليلى';
  const editorEmployee = ids.newId();
  await insertEditor(base, editorId, editorMembership, editorEmployee, role, nameEn, nameAr);
  const owners = await base.h.owner`SELECT id FROM memberships
    WHERE company_id=${base.company} AND user_id=${base.ownerId} AND scope_type='COMPANY' ORDER BY id`;
  return { editorId, editorMembership, editorEmployee, editorCookie, ownerMembership: must(owners[0])['id'] as string };
}

async function insertEditor(
  base: SessionFixture,
  editorId: string,
  editorMembership: string,
  editorEmployee: string,
  role: string,
  nameEn: string,
  nameAr: string,
) {
  await base.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${base.company},${editorMembership},${editorId},${role},'global','BRANCH',${base.branch},2000,'2026-01-01T00:00:00Z')`;
  await base.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,name_ar,name_ar_key,role_code,hire_date,employee_number)
    VALUES(${base.company},${editorEmployee},${base.business},${base.branch},${editorId},${nameEn},${employeeNameMatchKey(nameEn)},${nameAr},${employeeNameMatchKey(nameAr)},'branch_manager','2026-01-01',${takeTestEmployeeNumber(base.company)})`;
  await base.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${base.company},${ids.newId()},${base.business},${editorEmployee},${base.branch},'2026-01-01')`;
}

async function applyPerformerSnapshot(base: SessionFixture, lineId: string, rows: readonly PerformerSnapshot[]) {
  for (const row of rows) {
    await base.h.owner`UPDATE line_performers SET linked_user_id=${row.linked_user_id}, linked_user_snapshotted=${row.linked_user_snapshotted}
      WHERE company_id=${base.company} AND line_id=${lineId} AND employee_id=${row.employee_id}`;
  }
}
