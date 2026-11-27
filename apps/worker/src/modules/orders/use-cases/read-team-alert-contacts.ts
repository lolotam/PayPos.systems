import {
  needsTeamAlertContacts,
  type AlertChannel,
  type TeamAlertContact,
  type TeamAlertContactsPort,
} from '@pospay/domain';

/**
 * يقرأ جهات الاتصال على معاملة المستأجر لما قناة خارجية (بريد أو واتساب) مفعّلة وفي مستلمين؛
 * غياب المنفذ مع قناة خارجية خطأ تركيب ظاهر، وقواعد الجرس وحده لا تفتح قراءة إضافية.
 */
export async function readRequiredTeamAlertContacts(input: {
  readonly channels: readonly AlertChannel[];
  readonly userIds: readonly string[];
  readonly companyId: string;
  readonly at: Date;
  readonly contacts?: TeamAlertContactsPort | undefined;
}): Promise<ReadonlyMap<string, TeamAlertContact>> {
  if (!needsTeamAlertContacts(input.channels) || input.userIds.length === 0) return new Map();
  if (input.contacts === undefined) throw new Error('TEAM_ALERT_CONTACTS_UNAVAILABLE');
  return input.contacts.read(input.companyId, input.userIds, input.at);
}
