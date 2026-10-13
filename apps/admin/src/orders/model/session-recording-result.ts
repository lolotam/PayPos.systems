import { errorEnvelope, rejectedServiceLine, type AppendServiceSessionLinesResponse, type Customer,
  type RecordServiceSessionResponse, type RejectedServiceLine, type ServiceSession } from '@pospay/contracts';
import { SessionSavedDisplayFailure, sessionAttemptUnresolved, type SessionAttempt, type SessionAttemptCommand,
  type SessionJournalEnvelope } from './session-attempt';
import type { SessionAttemptJournal } from './session-attempt-journal';
import { createSessionDraft, type SessionDraftForm, type SessionDraftLine } from './session-drafts';

export type SessionFeedback = { kind: 'IDLE' | 'SAVING' | 'COMPLETE' | 'PARTIAL' | 'ALL_REJECTED' | 'UNRESOLVED' | 'EXPIRED' | 'SAVED_DISPLAY_FAILED' | 'NOT_PERSISTED' }
  | { kind: 'ERROR'; error: unknown; refreshScope: boolean };
export type SessionRecordingResult = {
  customer: Pick<Customer, 'id' | 'name' | 'phone'> | null; customerId: string | null; drafts: SessionDraftForm;
  session: ServiceSession | null; sessionId: string | null; addedLineIds: string[];
  rejected: { localId: string; error: RejectedServiceLine }[];
  feedback: SessionFeedback; attempt: SessionAttempt | null; persistenceWarning: 'NOT_PERSISTED' | null;
};
export type SessionResultEvent =
  | { type: 'RECORDED'; attempt: Extract<SessionAttempt, { kind: 'record' }>; response: RecordServiceSessionResponse; persistenceWarning?: 'NOT_PERSISTED' | null }
  | { type: 'APPENDED'; attempt: Extract<SessionAttempt, { kind: 'append' }>; response: AppendServiceSessionLinesResponse; persistenceWarning?: 'NOT_PERSISTED' | null }
  | { type: 'FAILED'; attempt: SessionAttempt; error: unknown }
  | { type: 'JOURNAL'; entry: SessionJournalEnvelope | null; persistenceWarning?: 'NOT_PERSISTED' | null; inFlight?: boolean };

export function emptySessionRecordingResult(customer: SessionRecordingResult['customer'] = null): SessionRecordingResult {
  return { customer, customerId: customer?.id ?? null, drafts: { lines: [] }, session: null, sessionId: null, addedLineIds: [], rejected: [], feedback: { kind: 'IDLE' }, attempt: null, persistenceWarning: null };
}
export const sessionResultFrozen = (state: SessionRecordingResult) =>
  !!state.persistenceWarning || ['SAVING', 'UNRESOLVED', 'EXPIRED', 'SAVED_DISPLAY_FAILED', 'NOT_PERSISTED'].includes(state.feedback.kind);
export const sessionResultLate = (session: ServiceSession) => session.late || session.lines.some((line) => line.late);
export const sessionBpsText = (bps: number) => String(bps).padStart(3, '0').replace(/(..)$/, '.$1');

function indexedRejections(attempt: SessionAttempt, errors: RejectedServiceLine[]) {
  return errors.map((error) => {
    const localId = attempt.rowIds[error.input_index];
    if (!localId) throw new Error('SESSION_RESULT_ROW_MAP_INVALID');
    return { localId, error };
  });
}
function retainRejected(drafts: SessionDraftForm, rejected: SessionRecordingResult['rejected']) {
  return { ...drafts, lines: drafts.lines.filter((line) => rejected.some((row) => row.localId === line.local_id)) };
}
function recoverAttempt(state: SessionRecordingResult, attempt: SessionAttempt, wantedIds = attempt.rowIds, replaceVisit = false): SessionRecordingResult {
  const sessionId = attempt.kind === 'append' ? attempt.sessionId : replaceVisit ? null : state.sessionId;
  if (state.sessionId !== sessionId) state = emptySessionRecordingResult(state.customer);
  const missing = attempt.body.lines.flatMap((line, index): SessionDraftLine[] => {
    const localId = attempt.rowIds[index];
    if (!localId || !wantedIds.includes(localId) || state.drafts.lines.some((row) => row.local_id === localId)) return [];
    const draft = createSessionDraft(localId);
    return [{ ...draft, service_id: line.service_id, price: line.price, discount_kind: line.discount.kind,
      discount_amount: line.discount.kind === 'AMOUNT' ? line.discount.amount : draft.discount_amount,
      discount_percentage: line.discount.kind === 'PERCENT' ? sessionBpsText(line.discount.bps) : draft.discount_percentage,
      share_mode: line.performers.some((row) => row.share_bps !== undefined) ? 'CUSTOM' : 'EQUAL',
      performers: line.performers.map((row) => ({ employee_id: row.employee_id, selection: null,
        share_percentage: row.share_bps === undefined ? '' : sessionBpsText(row.share_bps) })) }];
  });
  return { ...state, sessionId, customerId: attempt.kind === 'record' ? attempt.body.customer_id : state.customerId,
    drafts: missing.length ? { ...state.drafts, lines: [...state.drafts.lines, ...missing],
    recorder_membership_id: attempt.body.recorder_membership_id ?? null,
    ...(attempt.kind === 'record' ? { occurred_at: attempt.body.occurred_at } : {}) } : state.drafts };
}
function failedResult(state: SessionRecordingResult, attempt: SessionAttempt, error: unknown): SessionRecordingResult {
  state = recoverAttempt(state, attempt);
  if (error instanceof SessionSavedDisplayFailure) return { ...state, attempt: null,
    sessionId: attempt.kind === 'append' ? attempt.sessionId : error.sessionId ?? null, feedback: { kind: 'SAVED_DISPLAY_FAILED' } };
  if (sessionAttemptUnresolved(error)) return { ...state, attempt, feedback: { kind: 'UNRESOLVED' } };
  const envelope = errorEnvelope.safeParse(error);
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const details = envelope.success ? envelope.data.details : undefined;
  const errors = rejectedServiceLine.array().min(1).safeParse(details && typeof details === 'object' && 'rejected_lines' in details ? details.rejected_lines : undefined);
  if (status === 422 && envelope.success && envelope.data.code === 'SESSION_DISCOUNT_ABOVE_LIMIT' && errors.success) {
    const rejected = indexedRejections(attempt, errors.data);
    return { ...state, attempt: null, rejected, addedLineIds: [],
      drafts: attempt.kind === 'record' ? state.drafts : retainRejected(state.drafts, rejected),
      session: attempt.kind === 'record' ? null : state.session,
      sessionId: attempt.kind === 'record' ? null : attempt.sessionId, feedback: { kind: 'ALL_REJECTED' } };
  }
  return { ...state, attempt: null, rejected: [], addedLineIds: [], feedback: { kind: 'ERROR', error, refreshScope: status === 401 || status === 403 } };
}

export function transitionSessionRecordingResult(state: SessionRecordingResult, event: SessionResultEvent): SessionRecordingResult {
  if (event.type === 'FAILED') return failedResult(state, event.attempt, event.error);
  if (event.type === 'JOURNAL') {
    const entry = event.entry;
    const clearedPendingVisit = !entry && ['SAVING', 'UNRESOLVED', 'NOT_PERSISTED', 'PARTIAL'].includes(state.feedback.kind);
    if (clearedPendingVisit || (entry?.state === 'PARTIAL' && entry.sessionId !== state.sessionId)) state = emptySessionRecordingResult(state.customer);
    state = { ...state, persistenceWarning: event.persistenceWarning ?? null };
    if (entry?.state === 'PARTIAL') state = { ...state, sessionId: entry.sessionId };
    if (entry?.state === 'PENDING') return { ...recoverAttempt(state, entry.attempt, entry.attempt.rowIds, true), attempt: entry.attempt,
      persistenceWarning: event.persistenceWarning ?? null, feedback: { kind: event.inFlight ? 'SAVING' : 'UNRESOLVED' } };
    if (entry?.state === 'EXPIRED' || entry?.state === 'SAVED_DISPLAY_FAILED') return { ...state, attempt: null,
      sessionId: entry.sessionId ?? state.sessionId, feedback: { kind: entry.state } };
    if (event.persistenceWarning) return { ...state, attempt: null, feedback: { kind: 'NOT_PERSISTED' } };
    const feedback = ['NOT_PERSISTED', 'SAVING', 'UNRESOLVED'].includes(state.feedback.kind)
      ? { kind: state.session ? state.rejected.length ? 'PARTIAL' as const : 'COMPLETE' as const : 'IDLE' as const } : state.feedback;
    return { ...state, attempt: null, feedback };
  }
  const response = event.response, rejected = indexedRejections(event.attempt, response.rejected_lines);
  state = recoverAttempt(state, event.attempt, rejected.map((row) => row.localId));
  return { ...state, session: response.session, sessionId: response.session.id, attempt: null, rejected,
    customerId: response.session.customer.id, customer: state.customer ?? { id: response.session.customer.id, name: response.session.customer.name, phone: response.session.customer.phone_masked },
    persistenceWarning: event.persistenceWarning ?? null,
    addedLineIds: (event.type === 'APPENDED' ? event.response.added_lines : response.session.lines).map((line) => line.id),
    drafts: retainRejected(state.drafts, rejected), feedback: { kind: response.outcome } };
}

export function sessionLeaveFeedback(error: unknown): SessionFeedback {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : error instanceof Error ? error.message : undefined;
  if (code === 'SESSION_ATTEMPT_NOT_PERSISTED') return { kind: 'NOT_PERSISTED' };
  if (code === 'SESSION_ATTEMPT_UNRESOLVED') return { kind: 'UNRESOLVED' };
  return { kind: 'ERROR', error, refreshScope: false };
}

export function sessionResultCommand(state: SessionRecordingResult, lines: SessionAttemptCommand['body']['lines']): SessionAttemptCommand {
  if (sessionResultFrozen(state)) throw new Error('SESSION_ATTEMPT_UNRESOLVED');
  const body = { lines, ...(state.drafts.recorder_membership_id ? { recorder_membership_id: state.drafts.recorder_membership_id } : {}) };
  if (state.sessionId) return { kind: 'append', sessionId: state.sessionId, body };
  const customerId = state.customer?.id ?? state.customerId;
  if (!customerId) throw new Error('SESSION_CUSTOMER_REQUIRED');
  return { kind: 'record', body: { ...body, customer_id: customerId,
    ...(state.drafts.occurred_at ? { occurred_at: state.drafts.occurred_at } : {}) } };
}

export function newSessionVisit(state: SessionRecordingResult, journal: Pick<SessionAttemptJournal, 'leaveVisit'>, sameCustomer: boolean) {
  if (sessionResultFrozen(state) || state.feedback.kind !== 'COMPLETE' || state.drafts.lines.length) throw new Error('SESSION_VISIT_NOT_COMPLETE');
  journal.leaveVisit();
  return emptySessionRecordingResult(sameCustomer ? state.customer : null);
}
