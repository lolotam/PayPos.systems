import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import { temporaryStaffPinExpiresAt } from '../domain/staff-access-roles.ts';
import type { StaffPinScope, StaffPinTransactions } from '../ports/staff-pins.port.ts';

/**
 * هل صاحب الاعتماد عنده سجل «إعطاء الدخول» في الشركة دي؟ أي حالة بتتحسب (AC-ACT-9):
 * الرقم اللي المدير بيحدده ما يبقاش رقم دائم على موظفة عندها سجل.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param userId    صاحب الاعتماد
 * @returns true لو السجل موجود في الشركة
 */
async function hasStaffAccess(tx: Tx, companyId: string, userId: string): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT 1 FROM employee_staff_access
    WHERE company_id=${companyId} AND user_id=${userId} LIMIT 1`);
  return rows.length !== 0;
}

function scope(tx: Tx, companyId: string, ids: IdGenerator): StaffPinScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    member: async (userId) => {
      const rows = await tx.execute(sql`SELECT 1 FROM memberships WHERE company_id=${companyId}
        AND user_id=${userId} AND starts_at<=clock_timestamp()
        AND (ends_at IS NULL OR ends_at>clock_timestamp()) LIMIT 1`);
      return rows.length !== 0;
    },
    find: async (userId) => {
      // الرقم المؤقت الذي حدده المانح يُرفض كرقم غلط في كل قارئ لحد ما F2 تضيف تدفق التغيير (plan §1.1).
      const [row] = await tx.execute<{ id: string; hash: string; temporary: boolean }>(sql`
        SELECT id,pin_hash AS hash,temporary FROM cashier_pins WHERE company_id=${companyId} AND user_id=${userId}`);
      return row ?? null;
    },
    save: async (userId, hash, actor, at) => {
      // سياسة الرقم المؤقت (AC-ACT-9): موظفة عندها سجل «إعطاء الدخول» ما بتاخدش رقم دائم من المدير.
      const temporary = await hasStaffAccess(tx, companyId, userId);
      const expiresAt = temporary ? temporaryStaffPinExpiresAt(at) : null;
      await tx.execute(sql`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_by,set_at,temporary,expires_at)
        VALUES(${companyId},${ids.newId()},${userId},${hash},${actor},${at.toISOString()}::timestamptz,
          ${temporary},${expiresAt === null ? null : expiresAt.toISOString()}::timestamptz)
        ON CONFLICT(company_id,user_id) DO UPDATE SET id=EXCLUDED.id,pin_hash=EXCLUDED.pin_hash,
          set_by=EXCLUDED.set_by,set_at=EXCLUDED.set_at,temporary=EXCLUDED.temporary,
          expires_at=EXCLUDED.expires_at`);
    },
  };
}

/** RLS وpospay_app كما هما؛ المصادقة لا تحصل على grants لهذا الجدول. */
export function createStaffPinTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): StaffPinTransactions {
  return {
    run: (companyId, actor, work) =>
      db.withTenant(
        companyId,
        (tx) => work(scope(tx, companyId, ids)),
        actor === null ? {} : { userId: actor },
      ),
  };
}
