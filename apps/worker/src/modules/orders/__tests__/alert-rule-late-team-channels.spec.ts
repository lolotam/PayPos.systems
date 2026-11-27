import { afterAll, beforeAll, expect, it } from 'vitest';
import { lateServiceSessionNoticeRequested } from '@pospay/contracts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lateNoticeFixture, type LateNoticeFixture } from './late-notice.fixture.ts';

// AL-Q6 (صف 62b-1): قنوات الإيميل والواتساب على جرس «تسجيل خدمة متأخر»؛ الإيميل لا يخرج لغير الموثّق ما دام المفتاح true،
// والمُرسِل بيحل المستلمين من أدوار القاعدة حتى لو القناة الجرس مش مفعّلة.
let f: LateNoticeFixture;
beforeAll(async () => {
  f = await lateNoticeFixture();
});
afterAll(async () => {
  await f?.close();
});

const KIND = 'LATE_SERVICE_SESSION';
const OPERATIONAL = {
  locale: 'ar',
  template_key: 'late_service_session',
  template_revision: 1,
  safe_parameters: [],
};
const saveRule = (channels: string[], roles: string[]) =>
  f.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${f.tenant.company},${f.ids.newId()},${f.tenant.business},NULL,${KIND},true,
      ${f.owner.array(roles)},${f.owner.array(channels)},NULL,NULL,${USER},1)`;
const clearRules = () =>
  f.owner`DELETE FROM alert_rules
    WHERE company_id=${f.tenant.company} AND business_id=${f.tenant.business} AND kind=${KIND}`;
const recipients = (rows: Record<string, unknown>[]) =>
  rows.flatMap(
    (row) => lateServiceSessionNoticeRequested.parse(row['payload']).notification_recipients,
  );
// تغيير الهاتف بيصفّر اعتماد الربط (trigger user_staff_phone_binding)، فالاعتماد بيتكتب بعده في أمر مستقل.
async function setContact(
  user: string,
  patch: { verified: boolean; phone?: string; approved?: boolean },
): Promise<void> {
  await f.owner`UPDATE "user" SET email_verified=${patch.verified}, phone_number=${patch.phone ?? null} WHERE id=${user}`;
  if (patch.approved === true)
    await f.owner`UPDATE "user" SET phone_binding_approved_at=now() WHERE id=${user}`;
}

it('an email-only rule sends the verified manager an email and no bell, and leaves the unverified invitee out', async () => {
  const unverified = await f.user();
  await f.member(unverified, 'branch_manager', 'BRANCH', f.tenant.branch);
  await setContact(unverified, { verified: false });
  await saveRule(['EMAIL'], ['owner', 'branch_manager']);
  try {
    const session = await f.session();
    expect(await f.deliver(await f.event(session))).toEqual({ delivered: true });
    const sent = recipients(await f.requests(session));
    expect(sent).toEqual([
      { channel: 'email', email: 'orders-fixture@example.test', ...OPERATIONAL },
    ]);
    expect(await f.notices(session)).toMatchObject([{ recipient_count: 2 }]);
  } finally {
    await clearRules();
    await f.owner`DELETE FROM memberships WHERE user_id=${unverified}`;
  }
});

it('a WhatsApp rule sends only the manager with an approved phone binding, and never the bell', async () => {
  const approved = await f.user();
  await f.member(approved, 'branch_manager', 'BRANCH', f.tenant.branch);
  await setContact(approved, { verified: true, phone: '+999999620077', approved: true });
  await saveRule(['WHATSAPP'], ['branch_manager']);
  try {
    const session = await f.session();
    await f.deliver(await f.event(session));
    expect(recipients(await f.requests(session))).toEqual([
      { channel: 'whatsapp', phone: '+999999620077', ...OPERATIONAL },
    ]);
  } finally {
    await clearRules();
    await f.owner`DELETE FROM memberships WHERE user_id=${approved}`;
  }
});

it('all three channels give the same user a bell, an email and a WhatsApp recipient in one event', async () => {
  await setContact(USER, { verified: true, phone: '+999999620078', approved: true });
  await saveRule(['IN_APP', 'EMAIL', 'WHATSAPP'], ['owner']);
  try {
    const session = await f.session();
    await f.deliver(await f.event(session));
    const rows = await f.requests(session);
    expect(rows).toHaveLength(1);
    const sent = recipients(rows);
    expect(sent.map((recipient) => recipient.channel)).toEqual(['IN_APP', 'email', 'whatsapp']);
    expect(await f.notices(session)).toMatchObject([{ recipient_count: 1 }]);
  } finally {
    await clearRules();
    await setContact(USER, { verified: true });
  }
});

it('an external-only rule that finds no deliverable contact writes the decision and no event', async () => {
  await saveRule(['WHATSAPP'], ['owner']);
  try {
    const session = await f.session();
    await f.deliver(await f.event(session));
    expect(await f.notices(session)).toMatchObject([{ recipient_count: 1 }]);
    expect(await f.requests(session)).toHaveLength(0);
  } finally {
    await clearRules();
  }
});
