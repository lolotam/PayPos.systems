import type { Tx } from '@pospay/db';
import {
  needsTeamAlertContacts,
  type AlertChannel,
  type TeamAlertContact,
} from '@pospay/domain';
import { teamAlertRecipientContacts } from '../../identity/index.ts';
import type { TeamAlertAudience } from '../domain/team-alert-groups.ts';

/**
 * جهات اتصال مستلمي تنبيهات الفريق على معاملة المُرسِل نفسها (ADR-0003 §6a)؛ لا قراءة مباشرة لجدول المستخدمين.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param userIds المستلمين
 * @param at لحظة نافذة العضوية
 * @returns جهة اتصال لكل مستخدم عنده وجهة صالحة
 */
export function readTeamContacts(
  tx: Tx,
  companyId: string,
  userIds: readonly string[],
  at: Date,
): Promise<ReadonlyMap<string, TeamAlertContact>> {
  return teamAlertRecipientContacts(tx, companyId, userIds, at);
}

/**
 * يجهّز جمهور التنبيه لقارئ المستلمين في طبقة الحفظ: يقرا جهات الاتصال لما قناة خارجية مفعّلة فقط.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param channels القنوات المفعّلة في القاعدة
 * @param userIds المستلمين المؤهلين
 * @param at لحظة نافذة العضوية
 * @returns القنوات وجهات الاتصال
 */
export async function readTeamAlertAudience(
  tx: Tx,
  companyId: string,
  channels: readonly AlertChannel[],
  userIds: readonly string[],
  at: Date,
): Promise<TeamAlertAudience> {
  const contacts =
    needsTeamAlertContacts(channels) && userIds.length > 0
      ? await readTeamContacts(tx, companyId, userIds, at)
      : new Map();
  return { channels, contacts };
}
