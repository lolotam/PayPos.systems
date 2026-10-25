import { PlaywrightDocumentRenderer } from '@pospay/documents';
import { expect, it } from 'vitest';

import { createAttendanceStatementSource } from '../sources/attendance-statement.source.ts';
import type { StatementData } from '../sources/statement-ports.ts';
import { probeChromium } from './chromium-gate.ts';

const chromiumReady = await probeChromium();

const HOSTILE_NAME = 'Salon <script>alert(1)</script> & "Co"';

function data(): StatementData {
  return {
    businessId: '01920000-0000-7000-8000-0000000000b2',
    requesterUserId: '01920000-0000-7000-8000-0000000000c3',
    logoFileId: null,
    statement: {
      form: 'EMPLOYEE',
      language: 'ar',
      timezone: 'Asia/Kuwait',
      businessName: HOSTILE_NAME,
      branchName: 'Salmiya',
      period: { from: '2026-10-01', to: '2026-10-01' },
      employee: { name: HOSTILE_NAME, employeeNumber: 2 },
      totals: {
        daysPresent: 1,
        workedMinutes: 480,
        scheduledMinutes: 480,
        contractedMinutes: 480,
        differenceMinutes: 0,
        leave: [
          { type: 'ANNUAL', days: 0, partial_minutes: 0 },
          { type: 'SICK', days: 0, partial_minutes: 0 },
          { type: 'UNPAID', days: 0, partial_minutes: 0 },
          { type: 'OTHER', days: 0, partial_minutes: 0 },
        ],
        lateCount: 0,
        lateMinutes: 0,
        missingClockOut: 0,
        manualDays: 0,
      },
      days: [
        {
          date: '2026-10-01',
          sessions: [
            {
              clock_in: '2026-10-01T06:00:00.000Z',
              clock_out: '2026-10-01T14:00:00.000Z',
              late_minutes: 0,
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

it.skipIf(!chromiumReady)(
  'renders the statement through the real browser',
  async () => {
    let outer = '';
    const renderer = new PlaywrightDocumentRenderer({
      onDocumentHtml: (html) => {
        outer = html;
      },
    });
    const source = createAttendanceStatementSource({
      readStatement: async () => ({ kind: 'READY', data: data() }),
      readLogo: async () => null,
      clock: { now: () => new Date('2026-10-23T07:00:00Z') },
    });
    await renderer.start();
    try {
      expect(renderer.isAvailable()).toBe(true);
      const html = await source.load('company', 'render');
      const pdf = await renderer.render(html);
      expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
      expect(outer).toContain('lang="ar"');
      expect(outer).toContain('dir="rtl"');
      expect(outer).toContain('&lt;script&gt;');
      expect(outer).not.toContain('<script>');
    } finally {
      await renderer.close();
    }
  },
  60_000,
);
