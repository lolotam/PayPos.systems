import type { CustomerProfile } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * خطأ القراءة المنضّف: من غير cause ومن غير params. أخطاء السائق بتبعت SQL ورقم العميل في
 * الرسالة والـ stack، والفلتر بيطبع الخطأ الأصلي — فحد القراءة بيبعت خطأ نظيف بدل ما يعدّيه.
 */
export class CustomerProfileReadError extends Error {
  constructor() {
    super('CUSTOMER_PROFILE_READ_FAILED');
    this.name = 'CustomerProfileReadError';
  }
}

/** اسم النشاط كما بيجي من موديول tenancy: العربي اختياري والإنجليزي لازم. */
export interface CustomerProfileBusinessNames {
  /** الاسم العربي، أو null لو مش محفوظ. */
  readonly name_ar: string | null;
  /** الاسم الإنجليزي — دايماً موجود. */
  readonly name_en: string;
}

/**
 * أسماء أنشطة الملاحظات: قراءة واحدة لكل النشاطات المطلوبة، على نفس معاملة القراءة.
 */
export type CustomerProfileContext = (
  tx: Tx,
  companyId: string,
  businessIds: readonly string[],
) => Promise<ReadonlyMap<string, CustomerProfileBusinessNames>>;

/** توكن حقن أسماء النشاطات؛ الربط في موديول العملاء. */
export const CUSTOMER_PROFILE_CONTEXT = Symbol('CUSTOMER_PROFILE_CONTEXT');

type ProfileRow = {
  id: string;
  name: string;
  locale: 'ar' | 'en';
  opted_out: boolean;
  phone: string;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  gender: 'female' | 'male' | null;
  email: string | null;
};

type NoteRow = {
  business_id: string;
  note: string;
  created_at: string;
};

/** بطاقة العميل: هوية العميل وحقول ملفه الشخصي، من غير الملاحظات. */
export interface CustomerProfileCustomer {
  readonly id: string;
  readonly name: string;
  readonly locale: 'ar' | 'en';
  readonly opted_out: boolean;
  readonly phone: string;
  readonly birthday: {
    readonly day: number;
    readonly month: number;
    readonly year: number | null;
  } | null;
  readonly gender: 'female' | 'male' | null;
  readonly email: string | null;
}

/** ملاحظة العميل لنشاط واحد؛ اسم النشاط بييجي من موديول tenancy مش من هنا. */
export interface CustomerProfileNote {
  readonly business_id: string;
  readonly note: string;
  /** وقت الملاحظة كنص UTC زي ما العقد بيقوله؛ مش Date عشان محرّك Postgres بيرجع نص. */
  readonly created_at: string;
}

// الوقت بيترجم لنص UTC بنفس نمط المشروع، عشان العقد يستقبل نص زي ما بيبقى في الـ OpenAPI.
const instant = (column: string) =>
  sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// حد القراءة: أي خطأ من السائق بيتنضّف قبل ما يعدّي لحد أعلى.
async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new CustomerProfileReadError();
  }
}

/**
 * يقرأ بطاقة العميل وملاحظاته على نفس المعاملة.
 *
 * @param tx معاملة القراءة داخل الشركة
 * @param companyId الشركة
 * @param customerId العميل
 * @returns البطاقة مع ملاحظاتها، أو null لو العميل مش في الشركة
 */
export async function customerProfileQuery(
  tx: Tx,
  companyId: string,
  customerId: string,
): Promise<{ customer: CustomerProfileCustomer; notes: CustomerProfileNote[] } | null> {
  // إخفاء الهاتف في القاعدة نفسها: الرقم الكامل ما بيخرجش من الداتابيز أصلاً.
  const [row] = await safely(() =>
    tx.execute<ProfileRow>(sql`
    SELECT id, name, locale, opted_out_at IS NOT NULL AS opted_out,
      '***' || right(substring(phone from 2), 3) AS phone,
      birth_month, birth_day, birth_year, gender, email
    FROM customers WHERE company_id = ${companyId} AND id = ${customerId}`),
  );
  if (row === undefined) return null;
  const notes = await safely(() =>
    tx.execute<NoteRow>(sql`
    SELECT business_id, note, ${instant('created_at')} AS created_at FROM customer_notes
    WHERE company_id = ${companyId} AND customer_id = ${customerId}
    ORDER BY customer_notes.created_at, business_id`),
  );
  return {
    customer: {
      id: row.id,
      name: row.name,
      locale: row.locale,
      opted_out: row.opted_out,
      phone: row.phone,
      birthday:
        row.birth_month === null || row.birth_day === null
          ? null
          : { day: row.birth_day, month: row.birth_month, year: row.birth_year },
      gender: row.gender,
      email: row.email,
    },
    notes: notes.map((note) => ({
      business_id: note.business_id,
      note: note.note,
      created_at: note.created_at,
    })),
  };
}

/**
 * يجمع بطاقة العميل مع أسماء أنشط ملاحظاته؛ قراءة واحدة للملاحظات وواحدة لكل النشاطات.
 *
 * @param tx معاملة القراءة داخل الشركة
 * @param companyId الشركة
 * @param customerId العميل
 * @param names أسماء الأنشطة المقروءة من موديول tenancy
 * @returns البطاقة جاهزة للرد، أو null لو العميل مش في الشركة
 */
export async function readCustomerProfile(
  tx: Tx,
  companyId: string,
  customerId: string,
  names: CustomerProfileContext,
): Promise<CustomerProfile | null> {
  const profile = await customerProfileQuery(tx, companyId, customerId);
  if (profile === null) return null;
  const businessIds = [...new Set(profile.notes.map((note) => note.business_id))];
  const found =
    businessIds.length === 0
      ? new Map<string, CustomerProfileBusinessNames>()
      : await safely(() => names(tx, companyId, businessIds));
  return {
    id: profile.customer.id,
    name: profile.customer.name,
    locale: profile.customer.locale,
    opted_out: profile.customer.opted_out,
    phone: profile.customer.phone,
    birthday: profile.customer.birthday,
    gender: profile.customer.gender,
    email: profile.customer.email,
    notes: profile.notes.map((note) => {
      const name = found.get(note.business_id);
      // اسم مفقود يعني إن البيانات ناقصة؛ اسم فاضي كان هيدي رد ناقص من غير ما حد ياخد باله.
      if (name === undefined) throw new CustomerProfileReadError();
      return {
        business_id: note.business_id,
        business_name_ar: name.name_ar,
        business_name_en: name.name_en,
        note: note.note,
        created_at: note.created_at,
      };
    }),
  };
}
