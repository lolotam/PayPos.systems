import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import { temporaryStaffPinExpiresAt } from '../domain/staff-access-roles.ts';
import { CLEARED_STAFF_PIN_HASH } from './staff-user-auth.ts';
import type {
  StaffPinProofRecord,
  StaffPinScope,
  StaffPinTransactions,
} from '../ports/staff-pins.port.ts';

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

/**
 * بيحفظ بصمة الدليل — الدليل الخام ما يتخزنش، والصف مربوط بالجهاز والشركة وإصدار الـPIN.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param proof     صف الدليل
 */
async function insertProof(
  tx: Tx,
  companyId: string,
  proof: {
    readonly id: string;
    readonly userId: string;
    readonly deviceId: string;
    readonly pinRevision: string;
    readonly proofHash: string;
    readonly at: Date;
    readonly expiresAt: Date;
  },
): Promise<void> {
  await tx.execute(sql`INSERT INTO staff_pin_change_proofs
    (company_id,id,proof_hash,device_id,user_id,pin_revision,expires_at,created_at)
    VALUES(${companyId},${proof.id},${proof.proofHash},${proof.deviceId},${proof.userId},
      ${proof.pinRevision},${proof.expiresAt.toISOString()}::timestamptz,${proof.at.toISOString()}::timestamptz)`);
}

/**
 * بيقرأ الدليل بالبصمة والجهاز — من غير الدليل الخام، عشان هو اللي بيتسلّم للعميل.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param deviceId  الجهاز اللي issued عليه الدليل
 * @param proofHash بصمة الدليل
 * @returns الدليل كما هو، أو null
 */
async function readProof(
  tx: Tx,
  companyId: string,
  deviceId: string,
  proofHash: string,
): Promise<StaffPinProofRecord | null> {
  const [row] = await tx.execute<{
    user_id: string;
    pin_revision: string;
    expires_at_ms: number | null;
    consumed_at_ms: number | null;
  }>(sql`SELECT user_id,pin_revision,
    (extract(epoch from expires_at)*1000)::float8 AS expires_at_ms,
    (extract(epoch from consumed_at)*1000)::float8 AS consumed_at_ms
    FROM staff_pin_change_proofs
    WHERE company_id=${companyId} AND device_id=${deviceId} AND proof_hash=${proofHash}`);
  if (row === undefined) return null;
  return {
    userId: row.user_id,
    pinRevision: row.pin_revision,
    expiresAt: row.expires_at_ms === null ? null : new Date(row.expires_at_ms),
    consumedAt: row.consumed_at_ms === null ? null : new Date(row.consumed_at_ms),
  };
}

/**
 * استهلاك ذرّي للدليل: الـUPDATE بيرجع السطر بس لو الدليل لسه مستهلَك ولسه داخل مدته، فالطلب
 * التاني بيفشل على نفس الدليل حتى لو جاي في نفس اللحظة.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param proof     صاحب الدليل وإصدار الـPIN والبصمة ولحظة الاستهلاك
 * @returns true لو السطر اتحرق فعلاً
 */
async function burnProof(
  tx: Tx,
  companyId: string,
  proof: {
    readonly userId: string;
    readonly deviceId: string;
    readonly pinRevision: string;
    readonly proofHash: string;
    readonly at: Date;
  },
): Promise<boolean> {
  const rows = await tx.execute(sql`UPDATE staff_pin_change_proofs
    SET consumed_at=${proof.at.toISOString()}::timestamptz
    WHERE company_id=${companyId} AND proof_hash=${proof.proofHash} AND device_id=${proof.deviceId}
      AND user_id=${proof.userId} AND pin_revision=${proof.pinRevision}
      AND consumed_at IS NULL AND expires_at > ${proof.at.toISOString()}::timestamptz
    RETURNING id`);
  return rows.length !== 0;
}

/**
 * تدوير الـPIN: id جديد ورقم دائم. الـWHERE بيقفل على إصدار الـPIN، فأي reset المدير بعد إصدار
 * الدليل بيبطله.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param ids       مولّد الـid
 * @param pin       صاحب الرقم وإصداره والـhash الجديد ولحظة التغيير
 * @returns true لو الصف اتغيّر فعلاً
 */
async function rotatePin(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  pin: {
    readonly userId: string;
    readonly pinRevision: string;
    readonly hash: string;
    readonly at: Date;
  },
): Promise<boolean> {
  const rows = await tx.execute(sql`UPDATE cashier_pins
    SET id=${ids.newId()},pin_hash=${pin.hash},set_by=NULL,set_at=${pin.at.toISOString()}::timestamptz,
      temporary=false,expires_at=NULL
    WHERE company_id=${companyId} AND user_id=${pin.userId} AND id=${pin.pinRevision}
      AND NOT EXISTS (SELECT 1 FROM employee_staff_access a
        WHERE a.company_id=${companyId} AND a.user_id=${pin.userId} AND a.state <> 'ACTIVE')
    RETURNING id`);
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
      // الرقم المؤقت لسه بيترفض كرقم غلط لحد ما F2 يكمّل تدفق التغيير (plan §1.1): الحالة بترجع
      // مع الصف عشان الـuse case يقرّر يطلب تغيير ولا ي-refuse.
      const [row] = await tx.execute<{
        id: string;
        hash: string;
        temporary: boolean;
        expires_at_ms: number | null;
      }>(sql`SELECT id,pin_hash AS hash,temporary,
        (extract(epoch from expires_at)*1000)::float8 AS expires_at_ms
        FROM cashier_pins WHERE company_id=${companyId} AND user_id=${userId}
          AND pin_hash <> ${CLEARED_STAFF_PIN_HASH}`);
      if (row === undefined) return null;
      return {
        id: row.id,
        hash: row.hash,
        temporary: row.temporary,
        expiresAt: row.expires_at_ms === null ? null : new Date(row.expires_at_ms),
      };
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
    issueProof: async (proof) => insertProof(tx, companyId, proof),
    findProof: async (deviceId, proofHash) => readProof(tx, companyId, deviceId, proofHash),
    consumeProof: async (proof) => burnProof(tx, companyId, proof),
    rotatePin: async (pin) => rotatePin(tx, companyId, ids, pin),
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
