import { sql } from 'drizzle-orm';
import type { Tx } from '../src/with-tenant.ts';

export type SlcPatch = {
  businessId?: string;
  price?: string;
  discount?: string;
  net?: string;
  reason?: string;
  role?: string | null;
  roleSystem?: boolean | null;
  roleName?: string | null;
};

export type CancelLine = {
  companyId: string;
  lineId: string;
  expectedRevision: number;
  cancelledBy: string;
  membershipId: string;
  cancellationId: string;
  reason?: string;
  cancellerNameEn?: string;
  cancellerNameAr?: string | null;
  cancellerRole?: string | null;
  cancellerRoleIsSystem?: boolean | null;
  cancellerRoleNameAr?: string | null;
  cancellerRoleNameEn?: string | null;
};

// الأرقام لا تتغير مع الإلغاء، فنسخة «قبل» تُقرأ من السطر بعد تحديث الحالة داخل نفس المعاملة حتى يلحق القيد المؤجّل.
export async function cancelServiceLine(tx: Tx, input: CancelLine): Promise<void> {
  const updated = await tx.execute(
    sql`UPDATE service_lines SET status='CANCELLED', revision=revision+1
      WHERE company_id=${input.companyId} AND id=${input.lineId} AND status='ACTIVE' AND revision=${input.expectedRevision}
      RETURNING id`,
  );
  if (updated.length !== 1) {
    throw new Error('service line cancel compare-and-set matched no row');
  }
  await tx.execute(
    sql`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
      previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
      canceller_name_ar,canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_ar,canceller_role_name_en)
    SELECT company_id,${input.cancellationId},business_id,id,revision,revision - 1,price,discount,net,
      ${input.cancelledBy},${input.membershipId},clock_timestamp(),${input.reason ?? 'Cancelled'},
      ${input.cancellerNameAr ?? null},${input.cancellerNameEn ?? 'Synthetic canceller'},
      ${input.cancellerRole ?? null},${input.cancellerRoleIsSystem ?? null},
      ${input.cancellerRoleNameAr ?? null},${input.cancellerRoleNameEn ?? null}
    FROM service_lines WHERE company_id=${input.companyId} AND id=${input.lineId}`,
  );
}

// صف التاريخ اليدوي يختبر الرفض فقط؛ الإلغاء المقبول يمر من cancelServiceLine حتى تبقى الأرقام منسوخة من السطر.
export function historySql(
  scope: { company: string; business: string; userId: string; membershipId: string },
  cancellationId: string,
  lineId: string,
  revision: number,
  previous: number,
  patch: SlcPatch = {},
) {
  return sql`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
    canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_en)
  VALUES(${scope.company},${cancellationId},${patch.businessId ?? scope.business},${lineId},${revision},${previous},
    ${patch.price ?? '1.000'},${patch.discount ?? '0.000'},${patch.net ?? '1.000'},${scope.userId},${scope.membershipId},
    clock_timestamp(),${patch.reason ?? 'Cancelled'},'Synthetic canceller',${patch.role ?? null},${patch.roleSystem ?? null},${patch.roleName ?? null})`;
}
