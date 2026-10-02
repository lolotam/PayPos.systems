import { maskPhone } from './phone.ts';

/** هوية العميل المخزنة داخل الشركة؛ الهاتف لا يخرج من الموديول كاملاً. */
export interface CustomerRecord {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly optedOutAt: Date | null;
}

/**
 * يختار بيانات الاستقبال الآمنة ويحافظ على رفض العميل للتواصل عند البحث عنه من جديد.
 *
 * @param customer هوية العميل داخل الشركة الموثقة
 * @returns بيانات العرض بهاتف مخفي وحالة رفض التواصل فقط
 */
export function customerForReception(customer: CustomerRecord) {
  return {
    id: customer.id,
    name: customer.name,
    locale: customer.locale,
    opted_out: customer.optedOutAt !== null,
    phone: maskPhone(customer.phone),
  };
}
