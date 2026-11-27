import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  deriveOnboardingEnvelopeKey,
  MEMBER_INVITATION_KEY,
  onboardingPlaceholderEmail,
  unsealOnboardingEmailEnvelope,
} from '@pospay/notifications';

import { startHarness, type Harness } from '../../../../test/harness.ts';

const SEALING_KEY = 'onboarding-envelope-secret-key-0123456789';
const OWNER_EMAIL = 'g1-email-owner@example.test';
const MEMBER_EMAIL = 'g1-email-member@example.test';

type NoticeRecipient = {
  readonly email: string;
  readonly template_key: string;
  readonly template_revision: number;
  readonly safe_parameters: readonly { readonly name: string; readonly value: string }[];
};

const logChunks: Buffer[] = [];
let h: Harness;
let company: string;
let invitationId: string;

beforeAll(async () => {
  h = await startHarness({
    staffAccessRoutes: true,
    onboardingEmailKey: SEALING_KEY,
    logs: new Writable({
      write(chunk, _encoding, callback) {
        logChunks.push(chunk as Buffer);
        callback();
      },
    }),
  });
});
afterAll(async () => {
  await h?.close();
});

const noticeEvents = async () =>
  h.owner`SELECT event_type, payload FROM outbox WHERE event_type = 'MemberInvitationNoticeRequested'`;

const recipientsOf = (payload: unknown): readonly NoticeRecipient[] =>
  (payload as { notification_recipients?: NoticeRecipient[] }).notification_recipients ?? [];

it(
  'seals the invitation link for the invitee and the owner, with no plaintext in the outbox',
  { timeout: 90_000 },
  async () => {
    const cookie = await h.signedInOperator(OWNER_EMAIL);
    company = await h.onboard(cookie, 'G1 Email');
    const invited = await h.send('POST', '/v1/memberships/invitations', {
      cookie,
      company,
      body: {
        email: MEMBER_EMAIL,
        name: 'Invited',
        role: 'accountant',
        scope: { type: 'COMPANY', id: company },
        email_confirmed: true,
      },
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    invitationId = invited.body['invitation_id'] as string;
    const link = invited.body['set_password_link'] as string;
    const events = await noticeEvents();
    expect(events).toHaveLength(1);
    const recipients = recipientsOf(events[0]?.payload);
    expect(recipients).toHaveLength(2);
    for (const recipient of recipients) {
      expect(recipient.email).toMatch(/^sealed-[0-9a-f]{24}@redacted\.invalid$/);
      expect(recipient.template_key).toBe(MEMBER_INVITATION_KEY);
      expect(recipient.template_revision).toBe(1);
      expect(recipient.safe_parameters.length).toBeGreaterThan(0);
    }
    const serialized = JSON.stringify(events[0]?.payload);
    expect(serialized).not.toContain(MEMBER_EMAIL);
    expect(serialized).not.toContain(OWNER_EMAIL);
    expect(serialized).not.toContain(link);
    expect(serialized).not.toContain(new URL(link).pathname.split('/').pop() ?? '');

    const reissued = await h.send('POST', `/v1/memberships/invitations/${invitationId}/link`, {
      cookie,
      company,
    });
    expect(reissued.status).toBe(200);
    const reissuedLink = reissued.body['set_password_link'] as string;
    const allEvents = await noticeEvents();
    expect(allEvents).toHaveLength(2);
    const reissuedRecipients = recipientsOf(allEvents[1]?.payload);
    expect(reissuedRecipients).toHaveLength(2);
    const reissuedSerialized = JSON.stringify(allEvents[1]?.payload);
    expect(reissuedSerialized).not.toContain(reissuedLink);
    expect(reissuedSerialized).not.toContain(new URL(reissuedLink).pathname.split('/').pop() ?? '');
    const audits =
      await h.owner`SELECT action, before, after FROM audit_log WHERE company_id = ${company}`;
    for (const secret of [link, reissuedLink, MEMBER_EMAIL]) {
      expect(JSON.stringify(audits)).not.toContain(secret);
      expect(Buffer.concat(logChunks).toString('utf8')).not.toContain(secret);
    }
  },
);

it(
  'unseals the invitation notice for the worker with the shared key',
  { timeout: 90_000 },
  async () => {
    const key = deriveOnboardingEnvelopeKey(SEALING_KEY) ?? Buffer.alloc(0);
    const events = await noticeEvents();
    const recipients = recipientsOf(events[0]?.payload);
    const invitee = recipients.find(
      (recipient) => recipient.email === onboardingPlaceholderEmail(MEMBER_EMAIL, key),
    );
    expect(invitee).toBeDefined();
    const unsealed = unsealOnboardingEmailEnvelope(
      key,
      invitee?.safe_parameters ?? [],
      {
        companyId: company,
        templateKey: MEMBER_INVITATION_KEY,
        templateRevision: 1,
        placeholderEmail: invitee?.email ?? '',
      },
      new Date(),
    );
    expect(unsealed).toMatchObject({
      kind: 'member_invitation',
      email: MEMBER_EMAIL,
      role: 'accountant',
      recipient: 'invitee',
    });
    expect(String((unsealed as { link?: string } | null)?.link)).toContain('/reset-password/');
  },
);
