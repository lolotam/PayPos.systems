import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { devices } from './identity-devices.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

// PIN الكاشير (ADR-0003 §4 path B و§4.2، PRD D-08): بيثبت مين واقف على جهاز متوافق عليه، وعمره ما بيفتح app.
// الـ hash بس (packages/auth)، PIN واحد لكل موظف في الشركة. tenant data بـ RLS زي أي جدول شركة.
export const cashierPins = pgTable(
  'cashier_pins',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // الاعتماد باسم موظف لا يعبر حدود الشركة (ADR-0003 §4.2).
    employeeId: uuid('employee_id'),
    // قبل PR 8 صاحب اعتماد الاسترداد هو المستخدم الموجود، بلا إنشاء موظف أو عضوية جديدة.
    userId: uuid('user_id').references(() => user.id),
    pinHash: text('pin_hash').notNull(),
    // المدير اللي حط الـ PIN — null لو الموظف غيّره بنفسه على الجهاز بعدين (مالوش user).
    setBy: uuid('set_by').references(() => user.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull(),
    // رقم سري حدّده غير صاحبه (المانح) — كل قراءة ترفضه كرقم غلط لحد ما تدفق التغيير يشتغل في F2.
    temporary: boolean('temporary').notNull().default(false),
    // ينتهي بعد 24 ساعة لو ما اتاستخدمش (قرار D4)؛ NULL للأرقام الدائمة.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'cashier_pins_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'cashier_pins_employee_fk',
      columns: [t.companyId, t.employeeId],
      foreignColumns: [employees.companyId, employees.id],
    }),
    unique('cashier_pins_employee').on(t.companyId, t.employeeId),
    unique('cashier_pins_user').on(t.companyId, t.userId),
    check('cashier_pins_one_holder', sql`num_nonnulls(${t.employeeId}, ${t.userId}) = 1`),
    check('cashier_pins_hash_format', sql`${t.pinHash} LIKE 'pbkdf2-sha256$%'`),
    index('cashier_pins_set_by_idx').on(t.setBy),
  ],
);

// دليل تغيير الرقم السري المؤقت (076 F2): الموظفة اللي عندها سجل «إعطاء الدخول» بتدخل برقم المدير
// المؤقت لازم تغيّره الأول. الدليل نفسه مش بيتخزن — بصمته (SHA-256) بس، والدليل بيتحرق مرة واحدة
// لما يتغيّر الرقم. دليل على جهاز شركة: مستحيل جهاز شركة تانية يستعمله.
export const staffPinChangeProofs = pgTable(
  'staff_pin_change_proofs',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // بصمة الدليل (SHA-256 hex) — الدليل الخام عمره ما يتخزن ولا يتسجل.
    proofHash: text('proof_hash').notNull(),
    deviceId: uuid('device_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    // نسخة الـ PIN وقت إصدار الدليل: تبديل الرقم بعد الإصدار بيبطل الدليل.
    pinRevision: uuid('pin_revision').notNull(),
    // الدليل صالح مدة قصيرة من الإصدار، وبعد ما يتستهلك ما ينفعش يتعاد.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'staff_pin_change_proofs_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'staff_pin_change_proofs_device_fk',
      columns: [t.companyId, t.deviceId],
      foreignColumns: [devices.companyId, devices.id],
    }),
    // بصمة واحدة لكل شركة: الدليل بيتحرق مرة واحدة، فمفيش إعادة إصدار نفس البصمة.
    unique('staff_pin_change_proofs_company_id_proof_hash').on(t.companyId, t.proofHash),
    index('staff_pin_change_proofs_company_id_user_id_idx').on(t.companyId, t.userId),
    //_lookup بالدليل بيتم على (الشركة، الجهاز، البصمة).
    index('staff_pin_change_proofs_company_id_device_id_idx').on(t.companyId, t.deviceId),
    // الـ FK على user_id وحده (جدول اليوزر عام بلا company_id): فحص المرجع عند حذف يوزر محتاج فهرس
    // بيبدأ بـ user_id.
    index('staff_pin_change_proofs_user_id_idx').on(t.userId),
  ],
);
