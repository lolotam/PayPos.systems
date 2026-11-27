import { describe, expect, it } from 'vitest';

import {
  buildExternalTeamAlertRecipients,
  buildTeamAlertRecipients,
  chunkTeamAlertRecipients,
  needsTeamAlertContacts,
  teamAlertDelivery,
  teamAlertRecipientGroups,
  type TeamAlertContact,
} from '../team-alert-recipients.js';

const inApp = (userId: string) => ({ channel: 'IN_APP' as const, user_id: userId });
const contacts = (entries: Record<string, TeamAlertContact>) => new Map(Object.entries(entries));

describe('teamAlertDelivery', () => {
  const rule = { enabled: true, recipientRoles: ['owner'] as const, channels: ['EMAIL'] as const };

  it('keeps an email-only rule active, with its roles', () => {
    expect(teamAlertDelivery(rule)).toEqual({ roles: ['owner'], channels: ['EMAIL'] });
  });

  it('delivers to nobody when the rule is off or has no channel', () => {
    expect(teamAlertDelivery({ ...rule, enabled: false })).toEqual({ roles: [], channels: [] });
    expect(teamAlertDelivery({ ...rule, channels: [] })).toEqual({ roles: [], channels: [] });
  });
});

describe('needsTeamAlertContacts', () => {
  it('is true only when an external channel is on', () => {
    expect(needsTeamAlertContacts(['IN_APP'])).toBe(false);
    expect(needsTeamAlertContacts([])).toBe(false);
    expect(needsTeamAlertContacts(['IN_APP', 'EMAIL'])).toBe(true);
    expect(needsTeamAlertContacts(['WHATSAPP'])).toBe(true);
  });
});

describe('buildTeamAlertRecipients', () => {
  const base = { templateKey: 'low_rating', inApp, userIds: ['u1', 'u2', 'u3'] };
  const known = contacts({
    u1: { email: 'a@example.test', phoneNumber: '+999999620001' },
    u2: { email: null, phoneNumber: '+999999620002' },
  });

  it('builds the in-app recipient alone when no external channel is on', () => {
    expect(buildTeamAlertRecipients({ ...base, channels: ['IN_APP'], contacts: known })).toEqual([
      inApp('u1'),
      inApp('u2'),
      inApp('u3'),
    ]);
  });

  it('adds an email and a WhatsApp recipient only for a user with that destination, with no parameters', () => {
    const result = buildTeamAlertRecipients({
      ...base,
      channels: ['IN_APP', 'EMAIL', 'WHATSAPP'],
      contacts: known,
    });
    const operational = {
      locale: 'ar',
      template_key: 'low_rating',
      template_revision: 1,
      safe_parameters: [],
    };
    expect(result).toEqual([
      inApp('u1'),
      { channel: 'email', email: 'a@example.test', ...operational },
      { channel: 'whatsapp', phone: '+999999620001', ...operational },
      inApp('u2'),
      { channel: 'whatsapp', phone: '+999999620002', ...operational },
      inApp('u3'),
    ]);
  });

  it('keeps an email-only rule free of any in-app recipient', () => {
    const result = buildTeamAlertRecipients({ ...base, channels: ['EMAIL'], contacts: known });
    expect(result.map((r) => r.channel)).toEqual(['email']);
  });

  it('returns nothing for a user without a contact on an external-only rule', () => {
    expect(
      buildTeamAlertRecipients({
        ...base,
        channels: ['WHATSAPP', 'EMAIL'],
        contacts: contacts({}),
      }),
    ).toEqual([]);
  });
});

describe('buildExternalTeamAlertRecipients', () => {
  it('builds only the email and WhatsApp recipients and ignores the in-app channel', () => {
    const result = buildExternalTeamAlertRecipients({
      channels: ['IN_APP', 'EMAIL', 'WHATSAPP'],
      userIds: ['u1', 'u2'],
      contacts: contacts({ u1: { email: 'a@example.test', phoneNumber: '+999999620001' } }),
      templateKey: 'low_rating',
    });
    expect(result.map((r) => r.channel)).toEqual(['email', 'whatsapp']);
  });

  it('returns nothing for an in-app only rule', () => {
    expect(
      buildExternalTeamAlertRecipients({
        channels: ['IN_APP'],
        userIds: ['u1'],
        contacts: contacts({ u1: { email: 'a@example.test', phoneNumber: null } }),
        templateKey: 'low_rating',
      }),
    ).toEqual([]);
  });
});

describe('chunkTeamAlertRecipients', () => {
  it('splits by recipient count so three channels per user never pass the event cap', () => {
    const recipients = Array.from({ length: 250 }, (_, i) => i);
    const groups = chunkTeamAlertRecipients(recipients);
    expect(groups.map((g) => g.length)).toEqual([100, 100, 50]);
    expect(groups.flat()).toEqual(recipients);
  });

  it('never returns an empty group', () => {
    expect(chunkTeamAlertRecipients([])).toEqual([]);
    expect(chunkTeamAlertRecipients([1], 100)).toEqual([[1]]);
  });
});

describe('teamAlertRecipientGroups', () => {
  const base = { templateKey: 'low_rating', inApp, userIds: ['u1', 'u2'] };

  it('works without contacts for an in-app only rule', () => {
    const groups = teamAlertRecipientGroups({
      ...base,
      channels: ['IN_APP'],
    });
    expect(groups).toEqual([[inApp('u1'), inApp('u2')]]);
  });

  it('groups resolved contacts and in-app recipients by the event cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const contacts = new Map(many.map((u) => [u, { email: `${u}@example.test`, phoneNumber: null }]));
    const groups = teamAlertRecipientGroups({
      ...base,
      userIds: many,
      channels: ['IN_APP', 'EMAIL'],
      contacts,
    });
    expect(groups.map((g) => g.length)).toEqual([100, 20]);
  });

  it('returns no group without reading contacts when userIds is empty', () => {
    expect(
      teamAlertRecipientGroups({
        ...base,
        userIds: [],
        channels: ['EMAIL'],
      }),
    ).toEqual([]);
  });

  it('fails loudly when an external channel is on and no contacts map was provided', () => {
    expect(() => teamAlertRecipientGroups({ ...base, channels: ['WHATSAPP'] })).toThrow(
      'TEAM_ALERT_CONTACTS_UNAVAILABLE',
    );
  });
});
