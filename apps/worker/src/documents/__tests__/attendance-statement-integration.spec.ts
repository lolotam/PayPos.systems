import { UnrecoverableError, type Job } from 'bullmq';
import { documentBytesKey } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  attendanceStatementFixture,
  type AttendanceStatementFixture,
} from '../../modules/staff/__tests__/attendance-statement.fixture.ts';
import { processDocumentJob } from '../process-job.ts';
import type { HtmlDocumentSource } from '../source-registry.ts';
import { createAttendanceStatementSource } from '../sources/attendance-statement.source.ts';
import type { StatementLogoRequest } from '../sources/statement-ports.ts';
import type { FakeRenderer} from './render-harness.ts';
import { seedQueued, statusOf, useRender, type Opened } from './render-harness.ts';

const WORKING = '2026-10-01';
const SHIFT_START = new Date('2026-10-01T06:00:00.000Z');
const SHIFT_END = new Date('2026-10-01T14:00:00.000Z');
const CLOCK = new Date('2026-10-04T08:00:00.000Z');

let f: AttendanceStatementFixture;
beforeAll(async () => {
  f = await attendanceStatementFixture();
});
afterAll(async () => {
  await f?.close();
});

interface Spies {
  readonly statementReads: string[];
  readonly logoCalls: StatementLogoRequest[];
  readonly source: HtmlDocumentSource;
}

/**
 * المصدر بالقارئ الحقيقي وبقارئ شعار مزيف: النداءات بتتسجل، والشعار بيرجع null.
 */
function sourceSpy(): Spies {
  const statementReads: string[] = [];
  const logoCalls: StatementLogoRequest[] = [];
  const source = createAttendanceStatementSource({
    readStatement: async (companyId, renderId, signal) => {
      statementReads.push(renderId);
      return f.reader(companyId, renderId, signal);
    },
    readLogo: async (_companyId, request) => {
      logoCalls.push(request);
      return null;
    },
    clock: { now: () => CLOCK },
  });
  return { statementReads, logoCalls, source };
}

function asJob(data: unknown, attemptsMade: number): Job {
  return { data, attemptsMade, opts: { attempts: 2 } } as Job;
}

/** بيشغّل المصدر المسجّل من غير ما يلمس Redis غير حالة العرض. */
async function runStatement(
  opened: Opened,
  source: HtmlDocumentSource,
  companyId: string,
  renderId: string,
  attemptsMade: number,
): Promise<unknown> {
  opened.registry.register('attendance-statement', source);
  await seedQueued(opened, companyId, renderId);
  const started = Date.now();
  const data = { company_id: companyId, render_id: renderId, kind: 'attendance-statement' };
  return processDocumentJob(asJob(data, attemptsMade), {
    redis: opened.redis,
    registry: opened.registry,
    renderer: opened.renderer,
    clock: { now: () => started },
    logger: opened.logger,
  }).catch((error: unknown) => error);
}

it('a request without a logo renders to READY and never reads a logo', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara', nameAr: 'سارة' });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const renderId = await f.request(tenant);
  const spy = sourceSpy();
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const failure = await runStatement(opened, spy.source, tenant.company, renderId, 0);
    expect(failure).toBeUndefined();
    expect(spy.statementReads).toEqual([renderId]);
    expect(spy.logoCalls).toEqual([]);
    const status = await statusOf(opened, tenant.company, renderId);
    expect(status['state']).toBe('READY');
    const bytes = await opened.redis.getBuffer(documentBytesKey(tenant.company, renderId));
    expect(bytes?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const html = renderer.seen.join('\n');
    expect(html).toContain('صالون الأميرة');
    expect(html).toContain('سارة');
  });
});

it('a request with a logo file reads the logo once and still renders without an image', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const logoFileId = f.ids.newId();
  const renderId = await f.request(tenant, { logoFileId });
  const spy = sourceSpy();
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const failure = await runStatement(opened, spy.source, tenant.company, renderId, 0);
    expect(failure).toBeUndefined();
    expect(spy.logoCalls).toEqual([
      {
        businessId: tenant.business,
        fileId: logoFileId,
        requesterUserId: f.requesterId,
        renderId,
      },
    ]);
    const status = await statusOf(opened, tenant.company, renderId);
    expect(status['state']).toBe('READY');
    expect(renderer.seen.join('\n')).not.toContain('<img');
  });
});

it('an employee with no coverage ends the render empty and final', async () => {
  const tenant = await f.tenant();
  const nobody = await f.employee(tenant, { nameEn: 'Nobody' });
  const renderId = await f.request(tenant, { form: 'EMPLOYEE', employeeId: nobody });
  const spy = sourceSpy();
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const failure = await runStatement(opened, spy.source, tenant.company, renderId, 0);
    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toBe('STATEMENT_EMPTY');
    expect(spy.statementReads).toEqual([renderId]);
    const status = await statusOf(opened, tenant.company, renderId);
    expect(status['state']).toBe('FAILED');
    expect(status['error_code']).toBe('STATEMENT_EMPTY');
    expect(await opened.redis.exists(documentBytesKey(tenant.company, renderId))).toBe(0);
    expect(renderer.seen).toEqual([]);
  });
});

it('a render id of another tenant fails and renders nothing for it', async () => {
  const mine = await f.tenant();
  const other = await f.tenant();
  const renderId = await f.request(other);
  const spy = sourceSpy();
  await useRender(async (opened) => {
    const renderer = opened.renderer as FakeRenderer;
    const failure = await runStatement(opened, spy.source, mine.company, renderId, 1);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('DOCUMENT_RENDER_FAILED');
    const status = await statusOf(opened, mine.company, renderId);
    expect(status['state']).toBe('FAILED');
    expect(status['error_code']).toBe('DOCUMENT_RENDER_FAILED');
    expect(await opened.redis.exists(documentBytesKey(mine.company, renderId))).toBe(0);
    expect(renderer.seen).toEqual([]);
  });
});
