import type { AuditRecord } from '../../../../shared/ports/audit-trail.port.ts';
import type {
  DocumentBytesStore,
  DocumentStatusFacts,
  StatementCollectTransactions,
  StatementRequestRow,
} from '../../ports/attendance-statement.port.ts';
import {
  CollectAttendanceStatementUseCase,
  type CollectStatementResult,
} from './collect-attendance-statement.usecase.ts';

/** بايتات اصطناعية على شكل ملف PDF. */
export const collectBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** صف طلب فرع جاهز: من غير فلتر شيفت ومن غير موظفة. */
export const collectRow: StatementRequestRow = {
  id: 'render-1',
  companyId: 'company-1',
  businessId: 'business-1',
  branchId: 'branch-1',
  form: 'BRANCH',
  employeeId: null,
  from: '2026-10-01',
  to: '2026-10-31',
  language: 'ar',
  shift: null,
  logoFileId: null,
  requestedBy: 'user-1',
  requestedAt: new Date('2026-10-23T07:00:00.000Z'),
};

/** حالة التحميل أثناء الاختبار: اللي بتتحكم فيه كل حالة refusal. */
export interface CollectFixtureState {
  row: StatementRequestRow | null;
  status: DocumentStatusFacts | null;
  bytes: Uint8Array | null;
  audit: AuditRecord[];
  taken: number;
  consumed: number;
  auditFails: boolean;
  markConsumedFails: boolean;
}

export interface CollectFixture {
  state: CollectFixtureState;
  execute(): Promise<CollectStatementResult>;
}

/** بينزّل use case بمزودين في الذاكرة؛ كل حالة اختبار تغيّر في state وتشغّل execute. */
export function createCollectFixture(): CollectFixture {
  const state: CollectFixtureState = {
    row: { ...collectRow },
    status: { state: 'READY', requestedBy: 'user-1', mimeType: 'application/pdf' },
    bytes: collectBytes,
    audit: [],
    taken: 0,
    consumed: 0,
    auditFails: false,
    markConsumedFails: false,
  };
  const transactions: StatementCollectTransactions = {
    run: async (_scope, work) =>
      work({
        binding: async () => state.row,
        audit: {
          record: async (entry) => {
            if (state.auditFails) throw new Error('AUDIT_WRITE_FAILED');
            state.audit.push(entry);
          },
        },
      }),
  };
  const store: DocumentBytesStore = {
    status: async () => state.status,
    take: async () => {
      state.taken += 1;
      const bytes = state.bytes;
      state.bytes = null;
      return bytes;
    },
    markConsumed: async () => {
      state.consumed += 1;
      if (state.markConsumedFails) throw new Error('MARK_CONSUMED_FAILED');
      if (state.status !== null) state.status = { ...state.status, state: 'CONSUMED' };
    },
  };
  const useCase = new CollectAttendanceStatementUseCase(transactions, store);
  return {
    state,
    execute: () =>
      useCase.execute({
        companyId: 'company-1',
        userId: 'user-1',
        businessId: 'business-1',
        branchId: 'branch-1',
        renderId: 'render-1',
      }),
  };
}
