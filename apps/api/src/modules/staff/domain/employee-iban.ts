import { maskIban, validateIban, type GccBank } from '@pospay/domain';

/** رفض مصرفي لا يحمل القيمة أو بيانات موظف آخر. */
export class EmployeeIbanError extends Error {
  /**
   * ينقل سبب الرفض دون تضمين القيم الحساسة.
   *
   * @param code رمز الرفض المتفق عليه
   */
  constructor(
    readonly code:
      | 'IBAN_FORMAT_INVALID'
      | 'IBAN_COUNTRY_NOT_ALLOWED'
      | 'IBAN_CHECKSUM_INVALID'
      | 'IBAN_BANK_INVALID'
      | 'IBAN_HOLDER_NAME_INVALID'
      | 'EMPLOYEE_IBAN_ALREADY_USED'
      | 'EMPLOYEE_IBAN_REVISION_CONFLICT'
      | 'VALIDATION_FAILED'
      | 'NOT_FOUND'
      | 'FEATURE_DISABLED'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}
/** القيم الثلاث غائبة معاً عند مسح الحساب. */
export interface IbanEntryTerms {
  iban: string | null;
  bank_id: string | null;
  holder_name_en: string | null;
  reason: string;
}
/** نسخة محفوظة لا تقبل التعديل؛ الوقت يأتي من ساعة التخزين. */
export interface EmployeeIbanEntry extends IbanEntryTerms {
  id: string;
  employee_id: string;
  set_by: string;
  revision: number;
  set_at?: string;
}

/**
 * يطبق قواعد الدولة والبنك والاسم والسبب قبل أي حفظ؛ الرمز المعروف يلزم بنكه وحده.
 *
 * @param input حقول الطلب
 * @param banks القائمة المرجعية المعتمدة
 * @returns حقول موحدة جاهزة لإنشاء نسخة
 */
export function validateIbanEntry(
  input: IbanEntryTerms,
  banks: readonly GccBank[],
): IbanEntryTerms {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) throw new EmployeeIbanError('VALIDATION_FAILED');
  const fields = [input.iban, input.bank_id, input.holder_name_en];
  if (fields.every((v) => v === null))
    return { iban: null, bank_id: null, holder_name_en: null, reason };
  if (input.iban === null || input.bank_id === null || input.holder_name_en === null)
    throw new EmployeeIbanError('VALIDATION_FAILED');
  const validation = validateIban(input.iban);
  if (!validation.ok) {
    const codes = {
      FORMAT: 'IBAN_FORMAT_INVALID',
      COUNTRY: 'IBAN_COUNTRY_NOT_ALLOWED',
      CHECKSUM: 'IBAN_CHECKSUM_INVALID',
    } as const;
    throw new EmployeeIbanError(codes[validation.reason]);
  }
  const bank = banks.find((b) => b.id === input.bank_id);
  const mapped = banks.find(
    (b) => b.country === validation.country && b.ibanBankCode === validation.bankCode,
  );
  if (!bank || bank.country !== validation.country || (mapped && mapped.id !== bank.id))
    throw new EmployeeIbanError('IBAN_BANK_INVALID');
  const holder_name_en = input.holder_name_en.trim().replace(/\s+/g, ' ');
  if (holder_name_en.length > 100 || !/^[A-Za-z][A-Za-z .'-]*$/.test(holder_name_en))
    throw new EmployeeIbanError('IBAN_HOLDER_NAME_INVALID');
  return { iban: validation.iban, bank_id: bank.id, holder_name_en, reason };
}

/**
 * يرفض نسخة قديمة حتى لو كانت القيم متساوية؛ لا يكتب تكراراً أو مسحاً لحساب غير مضبوط.
 *
 * @param current آخر نسخة أو لا شيء
 * @param terms القيم الموحدة
 * @param id معرّف النسخة الجديدة
 * @param employeeId الموظف المستهدف
 * @param userId الممثل المتحقق منه
 * @param expectedRevision النسخة التي قرأها المحرر
 * @returns نسخة جديدة أو لا شيء عند عدم وجود تغيير
 */
export function nextIbanEntry(
  current: EmployeeIbanEntry | null,
  terms: IbanEntryTerms,
  id: string,
  employeeId: string,
  userId: string,
  expectedRevision: number,
): EmployeeIbanEntry | null {
  const revision = current?.revision ?? 0;
  if (expectedRevision !== revision) throw new EmployeeIbanError('EMPLOYEE_IBAN_REVISION_CONFLICT');
  if (
    (current?.iban ?? null) === terms.iban &&
    (current?.bank_id ?? null) === terms.bank_id &&
    (current?.holder_name_en ?? null) === terms.holder_name_en
  )
    return null;
  return { ...terms, id, employee_id: employeeId, set_by: userId, revision: revision + 1 };
}

/**
 * يسجل فقط آخر أربعة محارف والبنك؛ الاسم والحساب الكامل يبقيان في التاريخ المحمي.
 *
 * @param entry النسخة المراد تدقيقها
 * @returns لقطة آمنة أو لا شيء للحالة التي لم تضبط
 */
export function ibanAuditSnapshot(entry: EmployeeIbanEntry | null) {
  return entry === null
    ? null
    : {
        entry_id: entry.id,
        revision: entry.revision,
        iban_last4: entry.iban === null ? null : maskIban(entry.iban),
        bank_id: entry.bank_id,
        cleared: entry.iban === null,
      };
}

/**
 * يبني جواب المدير من النسخة المحفوظة داخل المعاملة؛ المسح يبقي رقم النسخة وتاريخه.
 *
 * @param entry آخر نسخة محفوظة
 * @returns العرض الكامل للممثل الذي تم التحقق من إذن إدارته
 */
export function managedIbanView(entry: EmployeeIbanEntry | null) {
  return {
    status: entry?.iban ? ('SET' as const) : ('NOT_SET' as const),
    iban_last4: entry?.iban ? maskIban(entry.iban) : null,
    iban: entry?.iban ?? null,
    bank_id: entry?.bank_id ?? null,
    holder_name_en: entry?.holder_name_en ?? null,
    revision: entry?.revision ?? 0,
    set_at: entry?.set_at ?? null,
    set_by: entry?.set_by ?? null,
    can_read_full: true,
    can_manage: true,
  };
}
