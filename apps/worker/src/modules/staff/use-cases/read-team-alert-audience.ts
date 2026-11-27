import { needsTeamAlertContacts, type AlertChannel } from '@pospay/domain';
import type { TeamAlertAudience } from '../domain/team-alert-groups.ts';
import type { TeamAlertContactSource } from '../ports/team-alert-audience.port.ts';

/** يجهّز جمهور التنبيه في حالة الاستخدام: يقرا جهات الاتصال لما قناة خارجية مفعّلة وفي مستلمين، وبلا صمت عند غياب المصدر. */
export async function teamAlertAudience(
  channels: readonly AlertChannel[],
  userIds: readonly string[],
  source: TeamAlertContactSource,
  at: Date,
): Promise<TeamAlertAudience> {
  if (!needsTeamAlertContacts(channels) || userIds.length === 0)
    return { channels, contacts: new Map() };
  if (source.contacts === undefined) throw new Error('TEAM_ALERT_CONTACTS_UNAVAILABLE');
  return { channels, contacts: await source.contacts(userIds, at) };
}
