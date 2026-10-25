import { attendanceStatementDocument, attendanceStatementLabelKeys } from '@pospay/contracts';
import type { AttendanceLeaveSummary } from '@pospay/domain';
import { attendanceStatementAr, attendanceStatementEn } from '@pospay/i18n';
import { expect, it } from 'vitest';

import { AttendanceStatementEmptyError } from '../statement-empty-error.ts';
import { buildAttendanceStatementDocument } from '../sources/attendance-statement-document.ts';
import { createAttendanceStatementSource } from '../sources/attendance-statement.source.ts';
import type {
  AttendanceStatementSourceDeps,
  StatementData,
  StatementLogo,
  StatementLogoRequest,
  StatementRead,
} from '../sources/statement-ports.ts';

const COMPANY_ID = '01920000-0000-7000-8000-0000000000a1';
const BUSINESS_ID = '01920000-0000-7000-8000-0000000000b2';
const USER_ID = '01920000-0000-7000-8000-0000000000c3';
const LOGO_FILE_ID = '01920000-0000-7000-8000-0000000000d4';
const RENDER_ID = '01920000-0000-7000-8000-0000000000e5';
const CLOCK = new Date('2026-10-23T07:00:00Z');
const HOSTILE_NAME = 'Salon <script>alert(1)</script> & "Co"';
const LOGO_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

const LEAVE: AttendanceLeaveSummary = [
  { type: 'ANNUAL', days: 1, partial_minutes: 0 },
  { type: 'SICK', days: 0, partial_minutes: 120 },
  { type: 'UNPAID', days: 0, partial_minutes: 0 },
  { type: 'OTHER', days: 0, partial_minutes: 0 },
];

function totals() {
  return {
    daysPresent: 22,
    workedMinutes: 10_740,
    scheduledMinutes: 10_560,
    contractedMinutes: 10_560,
    differenceMinutes: 180,
    leave: LEAVE,
    lateCount: 1,
    lateMinutes: 20,
    missingClockOut: 0,
    manualDays: 0,
  };
}

function branchData(
  logoFileId: string | null = LOGO_FILE_ID,
  language: 'ar' | 'en' = 'ar',
): StatementData {
  return {
    businessId: BUSINESS_ID,
    requesterUserId: USER_ID,
    logoFileId,
    statement: {
      form: 'BRANCH',
      language,
      timezone: 'Asia/Kuwait',
      businessName: HOSTILE_NAME,
      branchName: 'Salmiya',
      period: { from: '2026-10-01', to: '2026-10-31' },
      employeeFilter: null,
      shiftFilter: null,
      rows: [{ employeeNumber: 1, name: HOSTILE_NAME, totals: totals() }],
    },
  };
}

function employeeData(logoFileId: string | null = LOGO_FILE_ID): StatementData {
  return {
    businessId: BUSINESS_ID,
    requesterUserId: USER_ID,
    logoFileId,
    statement: {
      form: 'EMPLOYEE',
      language: 'ar',
      timezone: 'Asia/Kuwait',
      businessName: HOSTILE_NAME,
      branchName: 'Salmiya',
      period: { from: '2026-10-01', to: '2026-10-02' },
      employee: { name: HOSTILE_NAME, employeeNumber: 2 },
      totals: totals(),
      days: [
        {
          date: '2026-10-01',
          sessions: [
            {
              clock_in: '2026-10-01T06:00:00.000Z',
              clock_out: '2026-10-01T14:00:00.000Z',
              late_minutes: 20,
              manual: false,
              counted: true,
              missing_clock_out: false,
            },
          ],
          worked_minutes: 480,
          still_in: false,
          leave: [],
          scheduled: [
            { starts_at: '2026-10-01T06:00:00.000Z', ends_at: '2026-10-01T14:00:00.000Z' },
          ],
          no_attendance: false,
        },
      ],
    },
  };
}

interface Fake {
  readonly deps: AttendanceStatementSourceDeps;
  readonly order: string[];
  readonly logoRequests: StatementLogoRequest[];
}

/**
 * قارئان مزيفان وساعة ثابتة؛ الترتيب بيتسجل عشان نثبت إن النداءين ورا بعض (FR-010).
 */
function fake(options: {
  readonly read?: StatementRead;
  readonly logo?: StatementLogo | null;
  readonly logoFailure?: Error;
}): Fake {
  const order: string[] = [];
  const logoRequests: StatementLogoRequest[] = [];
  const deps: AttendanceStatementSourceDeps = {
    readStatement: async () => {
      order.push('statement');
      return options.read ?? { kind: 'READY', data: branchData() };
    },
    readLogo: async (_companyId, request) => {
      order.push('logo');
      logoRequests.push(request);
      if (options.logoFailure !== undefined) throw options.logoFailure;
      if (options.logo === undefined) {
        return { content_type: 'image/png', bytes: LOGO_BYTES };
      }
      return options.logo;
    },
    clock: { now: () => CLOCK },
  };
  return { deps, order, logoRequests };
}

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      keysOf(item, found);
    }
  }
  return found;
}

it('prints both forms with the names escaped', async () => {
  const branch = fake({});
  const branchSource = createAttendanceStatementSource(branch.deps);
  const branchHtml = await branchSource.load(COMPANY_ID, RENDER_ID);
  expect(branchHtml).toContain('&lt;script&gt;');
  expect(branchHtml).toContain('&amp;');
  expect(branchHtml).toContain('&quot;');
  expect(branchHtml).not.toContain('<script>');

  const employee = fake({ read: { kind: 'READY', data: employeeData() } });
  const employeeSource = createAttendanceStatementSource(employee.deps);
  const employeeHtml = await employeeSource.load(COMPANY_ID, RENDER_ID);
  expect(employeeHtml).toContain('&lt;script&gt;');
  expect(employeeHtml).not.toContain('<script>');
  expect(employeeHtml).toContain('dir="rtl"');
  expect(employeeHtml).toContain('lang="ar"');
});

it('reads the logo once with the request ids, after the statement', async () => {
  const fake1 = fake({});
  const source = createAttendanceStatementSource(fake1.deps);
  const html = await source.load(COMPANY_ID, RENDER_ID);
  expect(fake1.order).toEqual(['statement', 'logo']);
  expect(fake1.logoRequests).toEqual([
    {
      businessId: BUSINESS_ID,
      fileId: LOGO_FILE_ID,
      requesterUserId: USER_ID,
      renderId: RENDER_ID,
    },
  ]);
  const expected = Buffer.from(LOGO_BYTES).toString('base64');
  expect(html).toContain(`data:image/png;base64,${expected}`);
});

it('never calls the logo reader when the request recorded no logo', async () => {
  const fake1 = fake({ read: { kind: 'READY', data: branchData(null) } });
  const source = createAttendanceStatementSource(fake1.deps);
  const html = await source.load(COMPANY_ID, RENDER_ID);
  expect(fake1.order).toEqual(['statement']);
  expect(fake1.logoRequests).toEqual([]);
  expect(html).not.toContain('<img');
});

it('prints no logo when the reader finds nothing', async () => {
  const fake1 = fake({ logo: null });
  const source = createAttendanceStatementSource(fake1.deps);
  const html = await source.load(COMPANY_ID, RENDER_ID);
  expect(fake1.logoRequests).toHaveLength(1);
  expect(html).not.toContain('<img');
});

it('refuses an empty statement and never reads the logo', async () => {
  const fake1 = fake({ read: { kind: 'EMPTY' } });
  const source = createAttendanceStatementSource(fake1.deps);
  await expect(source.load(COMPANY_ID, RENDER_ID)).rejects.toBeInstanceOf(
    AttendanceStatementEmptyError,
  );
  expect(fake1.logoRequests).toEqual([]);
});

it('fails the attempt when the logo reader fails', async () => {
  const failure = new Error('STORAGE_UNAVAILABLE');
  const fake1 = fake({ logoFailure: failure });
  const source = createAttendanceStatementSource(fake1.deps);
  await expect(source.load(COMPANY_ID, RENDER_ID)).rejects.toBe(failure);
});

it('keeps every identifier out of the document', () => {
  const parsed = attendanceStatementDocument.parse(
    buildAttendanceStatementDocument({
      statement: branchData().statement,
      logo: null,
      issuedAt: CLOCK,
    }),
  );
  const keys = keysOf(parsed);
  expect(keys).not.toContain('businessId');
  expect(keys).not.toContain('requesterUserId');
  expect(keys).not.toContain('logoFileId');
  expect(JSON.stringify(parsed)).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
});

it('prints the generation time from the injected clock in the branch zone', async () => {
  const arabic = fake({});
  const arabicSource = createAttendanceStatementSource(arabic.deps);
  const arabicHtml = await arabicSource.load(COMPANY_ID, RENDER_ID);
  expect(arabicHtml).toContain('10:00');

  const english = fake({ read: { kind: 'READY', data: branchData(LOGO_FILE_ID, 'en') } });
  const englishSource = createAttendanceStatementSource(english.deps);
  const englishHtml = await englishSource.load(COMPANY_ID, RENDER_ID);
  expect(englishHtml).toContain('10:00');
  expect(englishHtml).toContain('dir="ltr"');
  expect(englishHtml).toContain('lang="en"');
});

it('prints the durations as h:mm', async () => {
  const fake1 = fake({});
  const source = createAttendanceStatementSource(fake1.deps);
  const html = await source.load(COMPANY_ID, RENDER_ID);
  expect(html).toContain('179:00');
  expect(html).toContain('176:00');
  expect(html).toContain('3:00');
  expect(html).toContain('2:00');
});

it('prints the headings of the request language and keeps the catalog equal to the contract', async () => {
  const arabic = fake({});
  const arabicSource = createAttendanceStatementSource(arabic.deps);
  const arabicHtml = await arabicSource.load(COMPANY_ID, RENDER_ID);
  expect(arabicHtml).toContain(attendanceStatementAr.branchTitle);
  expect(arabicHtml).toContain(attendanceStatementAr.footer);

  const english = fake({ read: { kind: 'READY', data: branchData(LOGO_FILE_ID, 'en') } });
  const englishSource = createAttendanceStatementSource(english.deps);
  const englishHtml = await englishSource.load(COMPANY_ID, RENDER_ID);
  expect(englishHtml).toContain(attendanceStatementEn.branchTitle);
  expect(englishHtml).toContain(attendanceStatementEn.footer);

  const keys = [...attendanceStatementLabelKeys].sort();
  expect(Object.keys(attendanceStatementAr).sort()).toEqual(keys);
  expect(Object.keys(attendanceStatementEn).sort()).toEqual(keys);
});
