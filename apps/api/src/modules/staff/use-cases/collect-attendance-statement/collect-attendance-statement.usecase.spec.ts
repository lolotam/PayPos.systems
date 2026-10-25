import { beforeEach, describe, expect, it } from 'vitest';

import type { AttendanceStatementError } from '../../domain/errors.ts';
import {
  collectBytes,
  collectRow,
  createCollectFixture,
  type CollectFixture,
} from './collect-attendance-statement.fixture.ts';

let f: CollectFixture;
beforeEach(() => {
  f = createCollectFixture();
});

async function expectRefusal(code: AttendanceStatementError['code']) {
  await expect(f.execute()).rejects.toMatchObject({ code });
}

describe('the first collect', () => {
  it('delivers the bytes, the mime type and the ASCII file name of the request row', async () => {
    await expect(f.execute()).resolves.toEqual({
      bytes: collectBytes,
      mimeType: 'application/pdf',
      filename: 'attendance-statement-branch-2026-10-01_2026-10-31.pdf',
    });
    expect(f.state.taken).toBe(1);
    expect(f.state.consumed).toBe(1);
  });

  it('records exactly one download with the fields of the statement', async () => {
    await f.execute();
    expect(f.state.audit).toEqual([
      {
        entity: 'attendance_statement',
        entityId: 'render-1',
        action: 'attendance.statement.downloaded',
        after: {
          form: 'BRANCH',
          business_id: 'business-1',
          branch_id: 'branch-1',
          employee_id: null,
          from: '2026-10-01',
          to: '2026-10-31',
          shift: null,
          language: 'ar',
        },
      },
    ]);
  });

  it('records the employee and the shift filter of a filtered statement', async () => {
    f.state.row = {
      ...collectRow,
      form: 'EMPLOYEE',
      employeeId: 'employee-1',
      shift: { start: '09:00', end: '20:00' },
    };
    await f.execute();
    expect(f.state.audit[0]?.after).toMatchObject({
      form: 'EMPLOYEE',
      employee_id: 'employee-1',
      shift: { start: '09:00', end: '20:00' },
    });
  });

  it('falls back to the PDF type when the status carries no mime type', async () => {
    f.state.status = { state: 'READY', requestedBy: 'user-1', mimeType: null };
    await expect(f.execute()).resolves.toMatchObject({ mimeType: 'application/pdf' });
  });
});

describe('the refusals', () => {
  it('refuses a request row that is not there', async () => {
    f.state.row = null;
    await expectRefusal('NOT_FOUND');
    expect(f.state.taken).toBe(0);
  });

  it('refuses a status hash of another user without taking the bytes', async () => {
    f.state.status = { state: 'READY', requestedBy: 'user-2', mimeType: 'application/pdf' };
    await expectRefusal('NOT_FOUND');
    expect(f.state.taken).toBe(0);
  });

  it('refuses a render that is still queued or rendering without taking the bytes', async () => {
    for (const renderState of ['QUEUED', 'RENDERING'] as const) {
      f.state.status = { state: renderState, requestedBy: 'user-1', mimeType: null };
      await expectRefusal('NOT_READY');
    }
    expect(f.state.taken).toBe(0);
  });

  it('refuses a failed render without taking the bytes', async () => {
    f.state.status = { state: 'FAILED', requestedBy: 'user-1', mimeType: null };
    await expectRefusal('NOT_READY');
    expect(f.state.taken).toBe(0);
  });

  it('refuses a second collect of the same render', async () => {
    await f.execute();
    await expectRefusal('EXPIRED');
    expect(f.state.audit).toHaveLength(1);
  });

  it('refuses a ready render whose bytes are gone', async () => {
    f.state.bytes = null;
    await expectRefusal('EXPIRED');
    expect(f.state.audit).toEqual([]);
  });
});

describe('the failures around the delivery', () => {
  it('a failing audit write stops the collect and nothing is marked as delivered', async () => {
    f.state.auditFails = true;
    await expect(f.execute()).rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(f.state.consumed).toBe(0);
    expect(f.state.audit).toEqual([]);
  });

  it('a failing delivery mark does not fail the collect', async () => {
    f.state.markConsumedFails = true;
    await expect(f.execute()).resolves.toMatchObject({ mimeType: 'application/pdf' });
    expect(f.state.consumed).toBe(1);
  });
});
