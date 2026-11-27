import { describe, expect, it } from 'vitest';

import {
  deriveOnboardingEnvelopeKey,
  maskOnboardingEmail,
  onboardingPlaceholderEmail,
  sealOnboardingEmailEnvelope,
  unsealOnboardingEmailEnvelope,
  MEMBER_INVITATION_KEY,
  ONBOARDING_EMAIL_CHUNK_SIZE,
  ONBOARDING_EMAIL_PARAM_PREFIX,
  ONBOARDING_PLACEHOLDER_DOMAIN,
  renderOperationalEmail,
  STAFF_WELCOME_PIN_KEY,
  type OnboardingEmailPayload,
  type OnboardingEnvelopeAad,
} from '../index.ts';

const SECRET = 'onboarding-envelope-secret-key-0123456789';
const ADMIN_ORIGIN = 'https://app.pospay.systems';
const COMPANY = '0f6c5d3a-2b1e-4a77-9d10-5b8e7c1d2a30';
const NOW = new Date('2026-11-27T10:00:00.000Z');

const key = deriveOnboardingEnvelopeKey(SECRET);

function aadFor(payload: OnboardingEmailPayload): OnboardingEnvelopeAad {
  const placeholder = onboardingPlaceholderEmail(payload.email, key ?? Buffer.alloc(0));
  return {
    companyId: COMPANY,
    templateKey:
      payload.kind === 'staff_welcome_pin' ? STAFF_WELCOME_PIN_KEY : MEMBER_INVITATION_KEY,
    templateRevision: 1,
    placeholderEmail: placeholder ?? '',
  };
}

const staffPayload: OnboardingEmailPayload = {
  kind: 'staff_welcome_pin',
  email: 'cashier@example.test',
  pin: '4821',
  role: 'cashier',
  recipient: 'manager',
  targetMaskedEmail: 'ca***@example.test',
  expiresAt: '2026-11-28T10:00:00.000Z',
  expiresAtMs: Date.parse('2026-11-28T10:00:00.000Z'),
};

const invitationPayload: OnboardingEmailPayload = {
  kind: 'member_invitation',
  email: 'invitee@example.test',
  link: 'https://api.pospay.systems/reset-password/token-123?callbackURL=https%3A%2F%2Fapp.pospay.systems%2Fset-password',
  role: 'accountant',
  recipient: 'invitee',
  targetMaskedEmail: null,
  expiresAt: '2026-11-29T10:00:00.000Z',
  expiresAtMs: Date.parse('2026-11-29T10:00:00.000Z'),
};

function sealStaff(): {
  readonly parameters: ReturnType<typeof sealOnboardingEmailEnvelope>;
  readonly placeholder: string;
} {
  const aad = aadFor(staffPayload);
  const placeholder = aad.placeholderEmail;
  return {
    parameters: sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad),
    placeholder,
  };
}

describe('the onboarding envelope key', () => {
  it('derives thirty-two bytes from a long secret', () => {
    expect(key).not.toBeNull();
    expect(key?.length).toBe(32);
    expect(deriveOnboardingEnvelopeKey(SECRET)?.equals(key ?? Buffer.alloc(0))).toBe(true);
  });

  it('refuses a short secret, an empty secret, and a secret with a line break', () => {
    expect(deriveOnboardingEnvelopeKey('')).toBeNull();
    expect(deriveOnboardingEnvelopeKey('short-secret')).toBeNull();
    expect(deriveOnboardingEnvelopeKey(`${SECRET}\nmore`)).toBeNull();
  });
});

describe('the masked onboarding email', () => {
  it('keeps two characters of the local part and the whole domain', () => {
    expect(maskOnboardingEmail('cashier@example.test')).toBe('ca***@example.test');
    expect(maskOnboardingEmail('a@example.test')).toBe('a***@example.test');
  });

  it('never leaks the local part or the domain of a long address', () => {
    const masked = maskOnboardingEmail('very.long.local.part@example.test');
    expect(masked).toBe('ve***@example.test');
    expect(masked).not.toContain('long');
  });
});

describe('the placeholder email', () => {
  it('is a distinct sealed address per recipient and hides the original', () => {
    const first = onboardingPlaceholderEmail('cashier@example.test', key ?? Buffer.alloc(0));
    const second = onboardingPlaceholderEmail('owner@example.test', key ?? Buffer.alloc(0));
    expect(first).toMatch(/^sealed-[0-9a-f]{24}@redacted\.invalid$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('example.test');
    expect(first?.endsWith(`@${ONBOARDING_PLACEHOLDER_DOMAIN}`)).toBe(true);
  });

  it('is stable for the same recipient and refuses an invalid address', () => {
    expect(onboardingPlaceholderEmail('cashier@example.test', key ?? Buffer.alloc(0))).toBe(
      onboardingPlaceholderEmail('cashier@example.test', key ?? Buffer.alloc(0)),
    );
    expect(onboardingPlaceholderEmail('not-an-email', key ?? Buffer.alloc(0))).toBeNull();
  });
});

describe('the sealed onboarding envelope', () => {
  it('round-trips the staff payload through named chunks', () => {
    const aad = aadFor(staffPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad);
    expect(parameters.length).toBeGreaterThan(0);
    expect(parameters.length).toBeLessThanOrEqual(20);
    for (const [index, parameter] of parameters.entries()) {
      expect(parameter.name).toBe(`${ONBOARDING_EMAIL_PARAM_PREFIX}${index}`);
      expect(parameter.type).toBe('text');
      expect(parameter.value.length).toBeLessThanOrEqual(ONBOARDING_EMAIL_CHUNK_SIZE);
    }
    const unsealed = unsealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), parameters, aad, NOW);
    expect(unsealed).toEqual(staffPayload);
  });

  it('round-trips the invitation payload', () => {
    const aad = aadFor(invitationPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), invitationPayload, aad);
    expect(unsealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), parameters, aad, NOW)).toEqual(
      invitationPayload,
    );
  });

  it('never carries the plaintext pin or the raw link in the chunk values', () => {
    const staff = sealStaff();
    const invitation = sealOnboardingEmailEnvelope(
      key ?? Buffer.alloc(0),
      invitationPayload,
      aadFor(invitationPayload),
    );
    const staffText = staff.parameters.map((parameter) => parameter.value).join('');
    const invitationText = invitation.map((parameter) => parameter.value).join('');
    expect(staffText).not.toContain('4821');
    expect(staffText).not.toContain('cashier@example.test');
    expect(invitationText).not.toContain('token-123');
    expect(invitationText).not.toContain('invitee@example.test');
  });

  it('refuses to seal when the placeholder does not match the payload', () => {
    expect(() =>
      sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, {
        ...aadFor(staffPayload),
        placeholderEmail: 'sealed-000000000000000000000000@redacted.invalid',
      }),
    ).toThrow('ONBOARDING_EMAIL_ENVELOPE_AAD_MISMATCH');
  });
});

describe('a tampered or broken envelope', () => {
  const unsealAt = (
    parameters: readonly {
      readonly name?: unknown;
      readonly type?: unknown;
      readonly value?: unknown;
    }[],
    aad: OnboardingEnvelopeAad = aadFor(staffPayload),
    now: Date = NOW,
  ) => unsealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), parameters, aad, now);

  it('returns null on a tampered chunk and on a missing chunk', () => {
    const aad = aadFor(staffPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad);
    const tampered = parameters.map((parameter, index) =>
      index === 0 ? { ...parameter, value: `${parameter.value.slice(0, -2)}xy` } : parameter,
    );
    expect(unsealAt(tampered, aad)).toBeNull();
    expect(unsealAt(parameters.slice(0, -1), aad)).toBeNull();
  });

  it('rejects a duplicate index and a missing index', () => {
    const aad = aadFor(staffPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad);
    expect(unsealAt([...parameters, parameters[0] as (typeof parameters)[0]], aad)).toBeNull();
    expect(unsealAt(parameters.slice(1), aad)).toBeNull();
  });

  it('reassembles the chunks by index, whatever order they arrive in', () => {
    const aad = aadFor(staffPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad);
    expect(unsealAt([...parameters].reverse(), aad)).toEqual(staffPayload);
  });

  it('returns null on a foreign key and on a foreign company', () => {
    const aad = aadFor(staffPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad);
    const otherKey =
      deriveOnboardingEnvelopeKey('another-onboarding-envelope-secret-key-987654') ??
      Buffer.alloc(0);
    expect(unsealOnboardingEmailEnvelope(otherKey, parameters, aad, NOW)).toBeNull();
    expect(
      unsealOnboardingEmailEnvelope(
        key ?? Buffer.alloc(0),
        parameters,
        { ...aad, companyId: '11111111-1111-4111-8111-111111111111' },
        NOW,
      ),
    ).toBeNull();
  });

  it('returns null on an expired envelope', () => {
    const aad = aadFor(staffPayload);
    const parameters = sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), staffPayload, aad);
    expect(unsealAt(parameters, aad, new Date('2026-11-30T10:00:00.000Z'))).toBeNull();
  });

  it('rejects an unknown chunk name, a non-text chunk, and an empty value', () => {
    const aad = aadFor(staffPayload);
    expect(unsealAt([{ name: 'other_0', type: 'text', value: 'abc' }], aad)).toBeNull();
    expect(unsealAt([{ name: 'env_0', type: 'number', value: 'abc' }], aad)).toBeNull();
    expect(unsealAt([{ name: 'env_0', type: 'text', value: '' }], aad)).toBeNull();
  });
});

function expectStaffWelcome(locale: string): void {
  const rendered = renderOperationalEmail(
    STAFF_WELCOME_PIN_KEY,
    1,
    locale,
    [staffPayload],
    ADMIN_ORIGIN,
  );
  expect(rendered).not.toBeNull();
  expect(rendered?.html).toContain('4821');
  expect(rendered?.text).toContain('4821');
  expect(rendered?.html).toContain('#FF6421');
  expect(rendered?.html).toContain('#5A6675');
  expect(rendered?.html).toContain(locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
}

describe('the staff welcome email', () => {
  it('renders in Arabic and English with the PIN, the forced change, and the expiry', () => {
    expectStaffWelcome('ar');
    expectStaffWelcome('en');
    const english = renderOperationalEmail(
      STAFF_WELCOME_PIN_KEY,
      1,
      'en',
      [staffPayload],
      ADMIN_ORIGIN,
    );
    expect(english?.html).toContain('dir="ltr"');
    expect(english?.text).toContain('must be changed');
    expect(english?.text).toContain('24 hours');
  });

  it('shows the masked target only to the manager', () => {
    const manager = renderOperationalEmail(
      STAFF_WELCOME_PIN_KEY,
      1,
      'en',
      [staffPayload],
      ADMIN_ORIGIN,
    );
    expect(manager?.text).toContain('ca***@example.test');
    const employee = renderOperationalEmail(
      STAFF_WELCOME_PIN_KEY,
      1,
      'en',
      [{ ...staffPayload, recipient: 'employee' }],
      ADMIN_ORIGIN,
    );
    expect(employee?.text).not.toContain('ca***@example.test');
  });

  it('refuses a bad revision, a bad locale, a bad PIN, and an unknown origin', () => {
    expect(
      renderOperationalEmail(STAFF_WELCOME_PIN_KEY, 2, 'ar', [staffPayload], ADMIN_ORIGIN),
    ).toBeNull();
    expect(
      renderOperationalEmail(STAFF_WELCOME_PIN_KEY, 1, 'fr', [staffPayload], ADMIN_ORIGIN),
    ).toBeNull();
    expect(
      renderOperationalEmail(
        STAFF_WELCOME_PIN_KEY,
        1,
        'ar',
        [{ ...staffPayload, pin: '48' }],
        ADMIN_ORIGIN,
      ),
    ).toBeNull();
  });
});

describe('the staff welcome email outside the known origins', () => {
  it('refuses an origin that is not an approved admin origin', () => {
    expect(
      renderOperationalEmail(
        STAFF_WELCOME_PIN_KEY,
        1,
        'ar',
        [staffPayload],
        'https://evil.example',
      ),
    ).toBeNull();
  });
});

describe('the member invitation email', () => {
  it('renders the link inside the body and in the text copy', () => {
    const rendered = renderOperationalEmail(
      MEMBER_INVITATION_KEY,
      1,
      'ar',
      [invitationPayload],
      ADMIN_ORIGIN,
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.html).toContain(`href="${invitationPayload.link}"`);
    expect(rendered?.html).toContain('#FF6421');
    expect(rendered?.text).toContain(invitationPayload.link);
    expect(rendered?.text).toContain('48');
  });

  it('refuses a link with credentials, a non-http scheme, and a control character', () => {
    const render = (link: string) =>
      renderOperationalEmail(
        MEMBER_INVITATION_KEY,
        1,
        'ar',
        [{ ...invitationPayload, link }],
        ADMIN_ORIGIN,
      );
    expect(render('https://user:pass@example.test/x')).toBeNull();
    expect(render('javascript:alert(1)')).toBeNull();
    expect(render('https://example.test/ ')).toBeNull();
  });

  it('shows the masked target only to the owner', () => {
    const owner = renderOperationalEmail(
      MEMBER_INVITATION_KEY,
      1,
      'en',
      [{ ...invitationPayload, recipient: 'owner', targetMaskedEmail: 'in***@example.test' }],
      ADMIN_ORIGIN,
    );
    expect(owner?.text).toContain('in***@example.test');
    const invitee = renderOperationalEmail(
      MEMBER_INVITATION_KEY,
      1,
      'en',
      [invitationPayload],
      ADMIN_ORIGIN,
    );
    expect(invitee?.text).not.toContain('in***@example.test');
  });
});
