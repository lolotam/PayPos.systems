import type { Tx } from '@pospay/db';
import type { TeamAlertContactsPort } from '@pospay/domain';
import { teamAlertRecipientContacts } from '../../identity/index.ts';

/**
 * قراءة جهات اتصال مستلمي تنبيه التقييم المنخفض على معاملة المستهلك نفسها (ADR-0003 §6a)؛ لا قراءة مباشرة لجدول المستخدمين.
 *
 * @param tx معاملة المستأجر
 * @returns منفذ جهات الاتصال
 */
export function teamContacts(tx: Tx): TeamAlertContactsPort {
  return { read: (companyId, userIds, at) => teamAlertRecipientContacts(tx, companyId, userIds, at) };
}
