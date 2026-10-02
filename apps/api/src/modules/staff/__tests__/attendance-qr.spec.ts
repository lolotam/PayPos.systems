import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  AttendanceQrBranchMissingError,
  AttendanceQrUnavailableError,
} from '../domain/attendance-qr.ts';
import { hmacAttendanceQr } from '../persistence/hmac-attendance-qr.ts';
import { createRedisAttendanceQrSecrets } from '../persistence/redis-attendance-qr-secrets.ts';
import type { AttendanceQrSecrets } from '../ports/attendance-qr.port.ts';
import { IssueAttendanceQr } from '../use-cases/issue-attendance-qr/issue-attendance-qr.ts';
import { VerifyAttendanceQr } from '../use-cases/verify-attendance-qr/verify-attendance-qr.ts';

const COMPANY = '01920000-0000-7000-8000-000000000001';
const BRANCH = '01920000-0000-7000-8000-000000000002';
const OTHER = '01920000-0000-7000-8000-000000000003';
const secret = 'ab'.repeat(32);

function setup() {
  let now = Date.parse('2026-10-02T20:59:59.000Z');
  const values = new Map<string, string>();
  const secrets: AttendanceQrSecrets = {
    getOrCreate: async (scope) => {
      const key = `${scope.companyId}:${scope.branchId}:${scope.day}`;
      if (!values.has(key)) values.set(key, scope.day.toString(16).padStart(64, '0'));
      return values.get(key) ?? '';
    },
    read: async (scope) => values.get(`${scope.companyId}:${scope.branchId}:${scope.day}`) ?? null,
  };
  const clock = { now: () => new Date(now) };
  const branches = {
    read: vi.fn(async () => ({
      id: BRANCH,
      name_ar: 'فرع الاختبار',
      name_en: 'Test branch',
      effective_timezone: 'Asia/Kuwait',
    })),
  };
  return {
    issue: new IssueAttendanceQr(branches, secrets, hmacAttendanceQr, clock),
    verify: new VerifyAttendanceQr(branches, secrets, hmacAttendanceQr, clock),
    setNow: (value: string) => {
      now = Date.parse(value);
    },
    branches,
    secrets,
    values,
  };
}

describe('attendance QR proof orchestration', () => {
  it('issues deterministic proofs and uses the previous day key across midnight', async () => {
    const s = setup();
    const issued = await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    expect(await s.issue.execute({ companyId: COMPANY, branchId: BRANCH })).toEqual(issued);
    const input = { companyId: COMPANY, branchId: BRANCH, token: issued.token };
    expect(await s.verify.execute(input)).toBe(true);
    s.setNow('2026-10-02T21:00:00.000Z');
    const next = await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    expect(next.token.sig).not.toBe(issued.token.sig);
    expect(s.values.size).toBe(2);
    expect(await s.verify.execute(input)).toBe(true);
    s.setNow('2026-10-02T21:00:59.999Z');
    expect(await s.verify.execute(input)).toBe(true);
    s.setNow('2026-10-02T21:01:00.000Z');
    expect(await s.verify.execute(input)).toBe(false);
  });

  it('rejects branch, tenant, payload and signature tampering without making secrets', async () => {
    const s = setup();
    const { token } = await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    const check = (partial: Partial<typeof token>, companyId = COMPANY, branchId = BRANCH) =>
      s.verify.execute({ companyId, branchId, token: { ...token, ...partial } });
    expect(await check({}, COMPANY, OTHER)).toBe(false);
    expect(await check({}, OTHER)).toBe(false);
    expect(await check({ branch_id: OTHER }, COMPANY, OTHER)).toBe(false);
    for (const window of [token.window - 2, token.window + 1, NaN, Number.MAX_SAFE_INTEGER, 1.5]) {
      expect(await check({ window })).toBe(false);
    }
    for (const sig of ['', 'g'.repeat(64), '0'.repeat(64), token.sig.toUpperCase()]) {
      expect(await check({ sig })).toBe(false);
    }
    expect(s.values.size).toBe(1);
    s.values.clear();
    expect(await check({})).toBe(false);
    expect(s.values.size).toBe(0);
  });
});

describe('replay window after asynchronous reads', () => {
  it.each([
    ['branch', '2026-10-02T12:01:59.999Z', '2026-10-02T12:02:00.050Z', false],
    ['branch', '2026-10-02T12:01:59.900Z', '2026-10-02T12:01:59.951Z', true],
    ['secret', '2026-10-02T12:01:59.999Z', '2026-10-02T12:02:00.050Z', false],
    ['secret', '2026-10-02T12:01:59.900Z', '2026-10-02T12:01:59.951Z', true],
  ] as const)('during %s read, %s -> %s is accepted: %s', async (read, start, finish, accepted) => {
    const s = setup();
    s.setNow('2026-10-02T12:00:00.000Z');
    const { token } = await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    s.setNow(start);
    if (read === 'branch') {
      const branch = await s.branches.read();
      s.branches.read.mockImplementationOnce(async () => {
        s.setNow(finish);
        return branch;
      });
    } else {
      const readSecret = s.secrets.read;
      vi.spyOn(s.secrets, 'read').mockImplementationOnce(async (scope) => {
        const value = await readSecret(scope);
        s.setNow(finish);
        return value;
      });
    }
    expect(await s.verify.execute({ companyId: COMPANY, branchId: BRANCH, token })).toBe(accepted);
  });
});

describe('daily branch timezone rollover', () => {
  it('does not rotate the Kuwait daily key at UTC midnight', async () => {
    const s = setup();
    s.setNow('2026-10-02T23:59:59.000Z');
    await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    s.setNow('2026-10-03T00:00:00.000Z');
    await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    expect(s.values.size).toBe(1);
  });

  it.each([
    ['2026-03-09T03:59:59Z', '2026-03-09T04:00:00Z', '2026-03-09T04:01:00Z'],
    ['2026-11-02T04:59:59Z', '2026-11-02T05:00:00Z', '2026-11-02T05:01:00Z'],
  ])('verifies the old DST day key after midnight (%s)', async (before, midnight, expired) => {
    const s = setup();
    s.branches.read.mockResolvedValue({
      id: BRANCH,
      name_ar: 'فرع الاختبار',
      name_en: 'Test branch',
      effective_timezone: 'America/New_York',
    });
    s.setNow(before);
    const { token } = await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    s.setNow(midnight);
    await s.issue.execute({ companyId: COMPANY, branchId: BRANCH });
    expect(s.values.size).toBe(2);
    expect(await s.verify.execute({ companyId: COMPANY, branchId: BRANCH, token })).toBe(true);
    s.setNow(expired);
    expect(await s.verify.execute({ companyId: COMPANY, branchId: BRANCH, token })).toBe(false);
  });
});

describe('attendance QR branch eligibility and signing', () => {
  it('does not initialize a secret for a missing branch', async () => {
    const create = vi.fn();
    const issue = new IssueAttendanceQr(
      { read: async () => null },
      { getOrCreate: create, read: async () => null },
      hmacAttendanceQr,
      { now: () => new Date(0) },
    );
    await expect(issue.execute({ companyId: COMPANY, branchId: BRANCH })).rejects.toBeInstanceOf(
      AttendanceQrBranchMissingError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('matches independently computed HMAC-SHA256 bytes and domain separation', () => {
    const expected = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(JSON.stringify(['pospay.attendance-qr.v1', COMPANY, BRANCH, 42]))
      .digest('hex');
    expect(hmacAttendanceQr.sign(COMPANY, BRANCH, 42, secret)).toBe(expected);
    expect(hmacAttendanceQr.verify(COMPANY, BRANCH, 42, secret, expected)).toBe(true);
    expect(hmacAttendanceQr.verify(OTHER, BRANCH, 42, secret, expected)).toBe(false);
    expect(hmacAttendanceQr.verify(COMPANY, OTHER, 42, secret, expected)).toBe(false);
    expect(hmacAttendanceQr.verify(COMPANY, BRANCH, 43, secret, expected)).toBe(false);
  });
});

describe('Redis unavailability is a bounded failure', () => {
  it('fails closed without retaining or exposing raw Redis errors', async () => {
    const redis = {
      get: async () => {
        throw new Error('synthetic connection error');
      },
    };
    const adapter = createRedisAttendanceQrSecrets(
      redis as unknown as Parameters<typeof createRedisAttendanceQrSecrets>[0],
    );
    const scope = { companyId: COMPANY, branchId: BRANCH, day: 0, retainUntil: 60_000 };
    await expect(adapter.getOrCreate(scope)).rejects.toBeInstanceOf(AttendanceQrUnavailableError);
    await expect(adapter.read(scope)).rejects.toMatchObject({ message: '' });
  });
});
