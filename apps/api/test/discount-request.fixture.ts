import { employeeNameMatchKey } from '@pospay/domain';
import { ordersDiscountRequests, ordersPendingProposals, ordersRequesterProposals } from '../src/modules/orders/orders.module.ts';
import { termsHash } from '../src/modules/orders/persistence/terms-hash.adapter.ts';
import { RequestDiscountApprovalUseCase } from '../src/modules/orders/use-cases/request-discount-approval/request-discount-approval.usecase.ts';
import { ids, must } from './service-session.fixture.ts';
import { editFixture, type EditFixture } from './service-line-edit.fixture.ts';

const PERFORMER_NAME_EN = 'Sara Performer';
const PERFORMER_NAME_AR = 'سارة أحمد';

/** طبقة اختيارية فوق editFixture: المستخدمة التي تطلب الموافقة ومنفّذة باسم من كلمتين. */
export async function discountRequestFixture(options: Parameters<typeof editFixture>[0] = {}) {
  const base = await editFixture(options);
  const otherBranch = ids.newId();
  await base.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${base.company},${otherBranch},${base.business},'Synthetic other branch')`;
  const performer = await linkPerformer(base);
  const request = new RequestDiscountApprovalUseCase(ordersDiscountRequests(base.db, ids), ids, base.clock, termsHash());
  const requester = ordersRequesterProposals(base.db, base.clock);
  const pending = ordersPendingProposals(base.db, base.clock);
  const context = (key = ids.newId(), actor = base.userId, fingerprint = 'a'.repeat(64)) => ({
    companyId: base.company,
    userId: actor,
    businessId: base.business,
    branchId: base.branch,
    key,
    fingerprint,
  });
  const draft = (serviceIndex = 0, price = '25.000', discount = '5.000', employeeIndex = 1) => ({
    service_id: must(base.services[serviceIndex]),
    price,
    discount: { kind: 'AMOUNT' as const, amount: discount },
    performers: [{ employee_id: must(base.employees[employeeIndex]) }],
  });
  const requestBody = (
    lines = [draft()],
    extra: { session_id?: string; occurred_at?: string; requester_membership_id?: string } = {},
  ) => ({
    customer_id: base.customer,
    lines,
    ...(extra.session_id === undefined ? {} : { session_id: extra.session_id }),
    ...(extra.occurred_at === undefined ? {} : { occurred_at: extra.occurred_at }),
    ...(extra.requester_membership_id === undefined ? {} : { requester_membership_id: extra.requester_membership_id }),
  });
  const proposalBase = `/v1/businesses/${base.business}/branches/${base.branch}/discount-proposals`;
  return { ...base, ...performer, otherBranch, request, requester, pending, context, draft, requestBody, proposalBase };
}

export type DiscountRequestFixture = Awaited<ReturnType<typeof discountRequestFixture>>;

/** المنفّذة لها اسم من كلمتين ورابط مستخدم، فتظهر لقطتا الاسم الأول والرابط (D-16، D-18). */
async function linkPerformer(base: EditFixture) {
  await base.h.signedInOperator('discount-performer@example.test');
  const users = await base.h.owner`SELECT id FROM "user" WHERE email='discount-performer@example.test'`;
  const userId = must(users[0])['id'] as string;
  const employeeId = must(base.employees[1]);
  await base.h.owner`UPDATE employees SET name_en=${PERFORMER_NAME_EN},name_en_key=${employeeNameMatchKey(PERFORMER_NAME_EN)},
    name_ar=${PERFORMER_NAME_AR},name_ar_key=${employeeNameMatchKey(PERFORMER_NAME_AR)},user_id=${userId}
    WHERE company_id=${base.company} AND id=${employeeId}`;
  return { performerUserId: userId, performerEmployeeId: employeeId };
}
