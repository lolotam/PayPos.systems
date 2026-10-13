import { errorEnvelope, rejectedServiceLine, type AppendServiceSessionLinesResponse, type Customer,
  type RecordServiceSessionResponse, type RejectedServiceLine, type ServiceSession } from '@pospay/contracts';
import { SessionSavedDisplayFailure, sessionAttemptUnresolved, type SessionAttempt, type SessionAttemptCommand,
  type SessionJournalEnvelope } from './session-attempt';
import type { SessionAttemptJournal } from './session-attempt-journal';
import type { SessionDraftForm } from './session-drafts';

export type SessionFeedback = { kind: 'IDLE' | 'SAVING' | 'COMPLETE' | 'PARTIAL' | 'ALL_REJECTED' | 'UNRESOLVED' | 'EXPIRED' | 'SAVED_DISPLAY_FAILED' | 'NOT_PERSISTED' }
  | { kind: 'ERROR'; error: unknown; refreshScope: boolean };
export type SessionRecordingResult = {
  customer: Pick<Customer, 'id' | 'name' | 'phone'> | null; drafts: SessionDraftForm;
  session: ServiceSession | null; sessionId: string | null; addedLineIds: string[];
  rejected: { localId: string; error: RejectedServiceLine }[];
  feedback: SessionFeedback; attempt: SessionAttempt | null; persistenceWarning: 'NOT_PERSISTED' | null;
};
export type SessionResultEvent =
  | { type: 'RECORDED'; attempt: Extract<SessionAttempt, { kind: 'record' }>; response: RecordServiceSessionResponse }
  | { type: 'APPENDED'; attempt: Extract<SessionAttempt, { kind: 'append' }>; response: AppendServiceSessionLinesResponse }
  | { type: 'FAILED'; attempt: SessionAttempt; error: unknown }
  | { type: 'JOURNAL'; entry: SessionJournalEnvelope | null; persistenceWarning?: 'NOT_PERSISTED' | null; inFlight?: boolean };

export function emptySessionRecordingResult(customer: SessionRecordingResult['customer'] = null): SessionRecordingResult {
  return { customer, drafts: { lines: [] }, session: null, sessionId: null, addedLineIds: [], rejected: [], feedback: { kind: 'IDLE' }, attempt: null, persistenceWarning: null };
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
function failedResult(state: SessionRecordingResult, attempt: SessionAttempt, error: unknown): SessionRecordingResult {
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
    state = { ...state, persistenceWarning: event.persistenceWarning ?? null };
    const entry = event.entry;
    if (entry?.state === 'PARTIAL') state = { ...state, sessionId: entry.sessionId };
    if (entry?.state === 'PENDING') return { ...state, attempt: entry.attempt, feedback: { kind: event.inFlight ? 'SAVING' : 'UNRESOLVED' } };
    if (entry?.state === 'EXPIRED' || entry?.state === 'SAVED_DISPLAY_FAILED') return { ...state, attempt: null,
      sessionId: entry.sessionId ?? state.sessionId, feedback: { kind: entry.state } };
    if (event.persistenceWarning) return { ...state, attempt: null, feedback: { kind: 'NOT_PERSISTED' } };
    return state;
  }
  const response = event.response, rejected = indexedRejections(event.attempt, response.rejected_lines);
  return { ...state, session: response.session, sessionId: response.session.id, attempt: null, rejected,
    addedLineIds: (event.type === 'APPENDED' ? event.response.added_lines : response.session.lines).map((line) => line.id),
    drafts: retainRejected(state.drafts, rejected), feedback: { kind: response.outcome } };
}

export function sessionResultCommand(state: SessionRecordingResult, lines: SessionAttemptCommand['body']['lines']): SessionAttemptCommand {
  if (sessionResultFrozen(state)) throw new Error('SESSION_ATTEMPT_UNRESOLVED');
  const body = { lines, ...(state.drafts.recorder_membership_id ? { recorder_membership_id: state.drafts.recorder_membership_id } : {}) };
  if (state.sessionId) return { kind: 'append', sessionId: state.sessionId, body };
  if (!state.customer) throw new Error('SESSION_CUSTOMER_REQUIRED');
  return { kind: 'record', body: { ...body, customer_id: state.customer.id,
    ...(state.drafts.occurred_at ? { occurred_at: state.drafts.occurred_at } : {}) } };
}

export function newSessionVisit(state: SessionRecordingResult, journal: Pick<SessionAttemptJournal, 'leaveVisit'>, sameCustomer: boolean) {
  if (sessionResultFrozen(state) || state.feedback.kind !== 'COMPLETE' || state.drafts.lines.length) throw new Error('SESSION_VISIT_NOT_COMPLETE');
  journal.leaveVisit();
  return emptySessionRecordingResult(sameCustomer ? state.customer : null);
}
