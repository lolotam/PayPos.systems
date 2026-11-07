import type { Tx } from '@pospay/db';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * يثبت صلاحية قراءة الذات داخل نفس المعاملة؛ المالك لا يتجاوز الملكية أو الميزة.
 *
 * @param tx معاملة القراءة
 * @param context هوية المستخدم والموظف والفروع المثبتة
 * @param now عينة الساعة المشتركة
 * @returns الفروع المسموحة بعد فحص العضوية والميزة
 */
export async function readOwnServiceSessionsAccess(
  tx: Tx,
  context: {
    companyId: string;
    businessId: string;
    userId: string;
    subjectUserId: string;
    branchIds: readonly string[];
  },
  now: Date,
): Promise<readonly string[]> {
  const access = await readAccessTransaction(tx, context.companyId, context.userId, now);
  if (!(await readFeatureEnabled(tx, context.companyId, 'orders', now))) return [];
  return context.branchIds.filter(
    (branchId) =>
      access.memberships.some(
        (m) =>
          (m.scopeType === 'COMPANY' && m.scopeId === context.companyId) ||
          (m.scopeType === 'BUSINESS' && m.scopeId === context.businessId) ||
          (m.scopeType === 'BRANCH' && m.scopeId === branchId),
      ) &&
      evaluateAccess(access.grants, 'read:service-sessions:own', {
        ...context,
        branchId,
        actorUserId: context.userId,
        subjectUserId: context.subjectUserId,
      }),
  );
}
