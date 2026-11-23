import { sql } from 'drizzle-orm';

// مصفوفة uuid كمعامل واحد مربوط: حجم الجملة وخطة التنفيذ لا يتبعان عدد المعرفات.
export const uuidList = (values: readonly string[]) => sql`${`{${values.join(',')}}`}::uuid[]`;

// نافذة الشهر على business_date؛ الحدّ الأعلى حصري كي لا يدخل أول يوم من الشهر التالي.
export const inMonth = (month: string) =>
  sql`business_date>=${`${month}-01`}::date AND business_date<(${`${month}-01`}::date+interval '1 month')`;

// مفتاح ترتيب بالميكروثانية كنص ثابت العرض: ترتيبه الأبجدي هو ترتيبه الزمني ولا يضيع شيء في Date.
export const occurredKey = sql`to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')`;

// لحظة الإلغاء بالميلي ثانية كما يقبلها عقد timestamp.
export const instantText = (column: string) =>
  sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
