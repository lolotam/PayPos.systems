import { describe, expect, it, vi } from 'vitest';
import { lowRatingReceived } from '@pospay/contracts';
import type { EffectiveAlertRule } from '@pospay/domain';

import type { StoredRating } from '../../../domain/low-rating-notice.ts';
import type {
  LowRatingEvent,
  LowRatingPorts,
  LowRatingRequest,
} from '../../../ports/low-rating-notice.ports.ts';
import { RequestLowRatingNotice } from '../request-low-rating-notice.ts';

const uuid = (n: number) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-07T10:00:00.000Z');
const EVENT: LowRatingEvent = {
  companyId: uuid(1),
  sourceEventId: uuid(2),
  ratingId: uuid(3),
  requestId: uuid(4),
  businessId: uuid(5),
  branchId: uuid(6),
  stars: 2,
};
const STORED: StoredRating = {
  requestId: EVENT.requestId,
  businessId: EVENT.businessId,
  branchId: EVENT.branchId,
  stars: 2,
  comment: null,
  businessDate: '2026-11-07',
  customerId: uuid(7),
};
const RULE: EffectiveAlertRule = {
  kind: 'LOW_RATING',
  source: 'DEFAULT',
  enabled: true,
  recipientRoles: ['owner'],
  channels: ['IN_APP'],
  delayMinutes: null,
  leadMinutes: null,
  fixedRecipients: [],
  masterOff: false,
};

interface Setup {
  readonly stored?: StoredRating | null;
  readonly rule?: Partial<EffectiveAlertRule>;
  readonly open?: boolean;
  readonly managers?: readonly string[];
  readonly readers?: readonly string[];
  readonly branch?: { nameAr: string | null; nameEn: string | null } | null;
  readonly claim?: boolean;
}

function build(setup: Setup = {}) {
  const appended: { id: string; ratingId: string; payload: LowRatingRequest }[] = [];
  let next = 100;
  const mocks = {
    rule: vi.fn(async () => ({ ...RULE, ...setup.rule })),
    managers: vi.fn(async () => setup.managers ?? [uuid(10)]),
    readers: vi.fn(async () => setup.readers ?? []),
    open: vi.fn(async () => setup.open ?? true),
    branch: vi.fn(async () =>
      setup.branch === undefined ? { nameAr: 'فرع', nameEn: 'Branch' } : setup.branch,
    ),
    rating: vi.fn(async () => (setup.stored === undefined ? STORED : setup.stored)),
    customer: vi.fn(
      async () =>
        ({ name: 'Synthetic customer', phone: '+12025550123' }) as {
          name: string;
          phone: string;
        } | null,
    ),
    claim: vi.fn<LowRatingPorts['repository']['claim']>(async () => setup.claim ?? true),
  };
  const ports: LowRatingPorts = {
    rules: { rule: mocks.rule },
    recipients: { managers: mocks.managers, commentReaders: mocks.readers },
    place: { companyOpen: mocks.open, forBranch: mocks.branch },
    repository: {
      readRating: mocks.rating,
      readCustomer: mocks.customer,
      performers: async () => [{ nameAr: 'ليلى', nameEn: 'Laila' }],
      claim: mocks.claim,
    },
    outbox: {
      append: async (id, ratingId, payload) => {
        appended.push({ id, ratingId, payload });
      },
    },
  };
  const useCase = new RequestLowRatingNotice(
    ports,
    { newId: () => uuid(next++) },
    { now: () => AT },
  );
  return { mocks, appended, run: (event = EVENT) => useCase.execute(event) };
}
const claimed = (t: ReturnType<typeof build>) => t.mocks.claim.mock.calls[0]?.[1];

describe('integrity and gates', () => {
  it('a stored rating that does not match the event fails as LOW_RATING_EVENT_INVALID', async () => {
    for (const stored of [null, { ...STORED, stars: 1 }, { ...STORED, branchId: uuid(99) }]) {
      const t = build({ stored });
      await expect(t.run()).rejects.toThrow('LOW_RATING_EVENT_INVALID');
      expect(t.mocks.claim).not.toHaveBeenCalled();
    }
  });

  it('a 3-star rating returns silently with no claim and no notice', async () => {
    const t = build({ stored: { ...STORED, stars: 3 } });
    await t.run({ ...EVENT, stars: 3 });
    expect(t.mocks.claim).not.toHaveBeenCalled();
    expect(t.appended).toEqual([]);
  });

  it('a closed company returns before the rule, the ledger or any notice', async () => {
    const t = build({ open: false });
    await t.run();
    expect(t.mocks.rule).not.toHaveBeenCalled();
    expect(t.mocks.claim).not.toHaveBeenCalled();
  });
});

describe('the decision ledger', () => {
  it.each([
    ['the rule is off', { rule: { enabled: false } }],
    ['there is no IN_APP channel', { rule: { channels: [] } }],
    ['there is no candidate', { managers: [] }],
    ['the branch is gone', { branch: null }],
  ] as const)('records zero recipients when %s, with no notice', async (_title, setup) => {
    const t = build(setup);
    await t.run();
    expect(claimed(t)).toMatchObject({ recipientCount: 0, decidedAt: AT });
    expect(t.appended).toEqual([]);
    expect(t.mocks.readers).not.toHaveBeenCalled();
  });

  it('an off rule makes no identity or place-name read', async () => {
    const t = build({ rule: { enabled: false } });
    await t.run();
    expect(t.mocks.managers).not.toHaveBeenCalled();
    expect(t.mocks.branch).not.toHaveBeenCalled();
  });

  it('a lost claim returns with no reader read, customer read or notice', async () => {
    const t = build({ claim: false, stored: { ...STORED, comment: 'x' } });
    await t.run();
    expect(t.mocks.readers).not.toHaveBeenCalled();
    expect(t.mocks.customer).not.toHaveBeenCalled();
    expect(t.appended).toEqual([]);
  });

  it('counts candidates once, sorted, whatever repeats the identity read returns', async () => {
    const t = build({ managers: [uuid(12), uuid(11), uuid(12)] });
    await t.run();
    expect(claimed(t)).toMatchObject({ recipientCount: 2 });
  });
});

describe('composition and emission', () => {
  it('without a comment everyone gets low_rating and readers are not read', async () => {
    const t = build({ managers: [uuid(10), uuid(11)], readers: [uuid(10)] });
    await t.run();
    expect(t.mocks.readers).not.toHaveBeenCalled();
    expect(t.appended).toHaveLength(1);
    expect(t.appended[0]).toMatchObject({ ratingId: EVENT.ratingId });
    expect(
      t.appended[0]?.payload.notification_recipients.map((r) => [r.user_id, r.template_key]),
    ).toEqual([
      [uuid(10), 'low_rating'],
      [uuid(11), 'low_rating'],
    ]);
  });

  it('a reader gets the comment as written, a DENY-holder gets the notice without it', async () => {
    const comment = 'اتصلوا بيا على 99887766';
    const t = build({
      stored: { ...STORED, comment },
      managers: [uuid(10), uuid(11)],
      readers: [uuid(11)],
    });
    await t.run();
    expect(t.appended).toHaveLength(2);
    const [withComment, plain] = t.appended.map((e) => e.payload);
    expect(withComment?.notification_recipients[0]).toMatchObject({
      user_id: uuid(11),
      template_key: 'low_rating_with_comment',
    });
    expect(JSON.stringify(withComment)).toContain(comment);
    expect(plain?.notification_recipients[0]).toMatchObject({
      user_id: uuid(10),
      template_key: 'low_rating',
    });
    expect(JSON.stringify(plain)).not.toContain('99887766');
    for (const request of t.appended)
      expect(lowRatingReceived.safeParse(request.payload).success).toBe(true);
  });

  it('101 candidates make two events of 100 and 1 with distinct ids', async () => {
    const t = build({ managers: Array.from({ length: 101 }, (_, i) => uuid(1000 + i)) });
    await t.run();
    expect(t.appended.map((e) => e.payload.notification_recipients.length)).toEqual([100, 1]);
    expect(new Set(t.appended.map((e) => e.id)).size).toBe(2);
  });

  it('a missing customer row fails the delivery instead of inventing an identity', async () => {
    const t = build();
    t.mocks.customer.mockResolvedValueOnce(null);
    await expect(t.run()).rejects.toThrow('LOW_RATING_CONTEXT_MISSING');
  });
});
