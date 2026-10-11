import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { monthlyReportLoadFixture } from './attendance-monthly-report-load.fixture.ts';
import { reportHeaders, reportUrl } from './attendance-monthly-report.fixture.ts';

describe('all branches: 3 x 30 employees x 31 days', () => {
const branches = 3, employees = 30;
let f: Awaited<ReturnType<typeof monthlyReportLoadFixture>>;
beforeAll(async () => { f = await monthlyReportLoadFixture(branches, employees); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

it('ten authenticated JSON and audited CSV responses at pilot scale stay under 200ms', async () => {
  const medians: number[] = [];
  for (const csv of [false,true]) {
    const samples: number[] = [];
    for (let index = 0; index < 12; index++) {
      const start = performance.now();
      const response = await f.h.app.inject({method:'GET',url:reportUrl(f,'all',csv),headers:reportHeaders(f)});
      const elapsed = performance.now()-start;
      expect(response.statusCode).toBe(200);
      if (!csv) {
        const rows = attendanceMonthlyReport.parse(response.json()).rows;
        expect(rows).toHaveLength(branches * employees);
        for (const row of rows) expect(row).toMatchObject({days_present:31,worked_minutes:14880,
          contracted_minutes:14880,scheduled_minutes:14880,difference_minutes:0});
      } else {
        expect(response.body).toMatch(/^\uFEFF/);
        expect(response.body.split('\r\n')).toHaveLength(branches * employees + 2);
      }
      if (index >= 2) samples.push(elapsed);
    }
    const sorted = samples.toSorted((a,b) => a-b);
    const median = ((sorted[4] ?? 0)+(sorted[5] ?? 0))/2;
    const result = {branches,employees_per_branch:employees,days:31,sessions:branches * employees * 62,
      format:csv ? 'CSV' : 'JSON',samples:10,median_ms:Number(median.toFixed(2)),max_ms:Number(Math.max(...samples).toFixed(2))};
    console.info('attendance_report_all_latency', result);
    medians.push(median);
  }
  // الوسيط مش الأقصى: عيّنة واحدة بطيئة على جهاز CI مشغول مش معناها إن المسار تقيل.
  expect(Math.max(...medians)).toBeLessThan(200);
}, 60_000);
});
