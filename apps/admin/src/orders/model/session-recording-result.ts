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
  visitTimeUnknown: boolean;
};
export type SessionResultEvent =
  | { type: 'RECORDED'; attempt: Extract<SessionAttempt, { kind: 'record' }>; response: RecordServiceSessionResponse; persistenceWarning?: 'NOT_PERSISTED' | null }
  | { type: 'APPENDED'; attempt: Extract<SessionAttempt, { kind: 'append' }>; response: AppendServiceSessionLinesResponse; persistenceWarning?: 'NOT_PERSISTED' | null }
  | { type: 'FAILED'; attempt: SessionAttempt; error: unknown }
  | { type: 'JOURNAL'; entry: SessionJournalEnvelope | null; persistenceWarning?: 'NOT_PERSISTED' | null; inFlight?: boolean };

export function emptySessionRecordingResult(customer: SessionRecordingResult['customer'] = null): SessionRecordingResult {
  return { customer, customerId: customer?.id ?? null, drafts: { lines: [] }, session: null, sessionId: null, addedLineIds: [], rejected: [], feedback: { kind: 'IDLE' }, attempt: null, persistenceWarning: null, visitTimeUnknown: false };
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
function rejectionSnapshots(drafts: SessionDraftForm, rejected: SessionRecordingResult['rejected']): SessionDraftForm {
  return { ...drafts, lines: drafts.lines.map((line) => {
    const error = rejected.find((row) => row.localId === line.local_id)?.error;
    return error && line.service?.revision === undefined ? { ...line, service: { id: error.service_id,
      name_ar: error.name_ar, name_en: error.name_en, price: error.list_price, price_source: 'CATALOG' } } : line;
  }) };
}
// الرأس يرجع من المحاولة وهي لسه مش محسومة: نفس المفتاح، أو استرجاع PENDING، أو سطر ناقص، أو مسودة فاضية مالهاش سطور ولا رأس.
// غير كده recorder_membership_id و occurred_at يفضلوا زي ما المستخدم سايبهم.
function withAttemptHeader(drafts: SessionDraftForm, attempt: SessionAttempt, lines: SessionDraftLine[]): SessionDraftForm {
  const recorder_membership_id = attempt.body.recorder_membership_id ?? null;
  const occurred_at = attempt.kind === 'record' ? attempt.body.occurred_at : drafts.occurred_at;
  if (lines === drafts.lines && drafts.recorder_membership_id === recorder_membership_id && drafts.occurred_at === occurred_at) return drafts;
  return { ...drafts, lines, recorder_membership_id, ...(attempt.kind === 'record' ? { occurred_at } : {}) };
}
// دفتر اليومية بيفضل حافظ مدخل PARTIAL في الذاكرة حتى لو الكتابة فشلت، فـ null هنا معناها الزيارة اتسابت فعلًا.
// SAVING و UNRESOLVED و PARTIAL تابعة للمدخل؛ NOT_PERSISTED تابعة له بس لو مفيش زيارة محفوظة؛ COMPLETE لأ.
function journalDependent(state: SessionRecordingResult) {
  const kind = state.feedback.kind;
  if (kind === 'SAVING' || kind === 'UNRESOLVED' || kind === 'PARTIAL') return true;
  return kind === 'NOT_PERSISTED' && !state.session;
}
// تحذير التخزين على زيارة محفوظة من غير محاولة في الدفتر ما يفضلّش SAVING: النتيجة المحفوظة COMPLETE أو PARTIAL.
function warnedFeedback(state: SessionRecordingResult): SessionFeedback {
  if (!state.session) return { kind: 'NOT_PERSISTED' };
  const kind = state.feedback.kind;
  if (kind === 'SAVING' || kind === 'UNRESOLVED') return { kind: state.rejected.length ? 'PARTIAL' : 'COMPLETE' };
  return state.feedback;
}
function recoverAttempt(state: SessionRecordingResult, attempt: SessionAttempt, wantedIds = attempt.rowIds, replaceVisit = false): SessionRecordingResult {
  const sessionId = attempt.kind === 'append' ? attempt.sessionId : replaceVisit ? null : state.sessionId;
  const sameAttempt = state.attempt?.key === attempt.key;
  if (state.sessionId !== sessionId) state = emptySessionRecordingResult(state.customer);
  const missing = attempt.body.lines.flatMap((line, index): SessionDraftLine[] => {
    const localId = attempt.rowIds[index];
    if (!localId || !wantedIds.includes(localId) || state.drafts.lines.some((row) => row.local_id === localId)) return [];
    const draft = createSessionDraft(localId);
    return [{ ...draft, service_id: line.service_id, price: line.price, discount_kind: line.discount.kind,
      service: { id: line.service_id, name_ar: null, name_en: line.service_id, price: line.price, price_source: 'INPUT' },
      discount_amount: line.discount.kind === 'AMOUNT' ? line.discount.amount : draft.discount_amount,
      discount_percentage: line.discount.kind === 'PERCENT' ? sessionBpsText(line.discount.bps) : draft.discount_percentage,
      share_mode: line.performers.some((row) => row.share_bps !== undefined) ? 'CUSTOM' : 'EQUAL',
      performers: line.performers.map((row) => ({ employee_id: row.employee_id, selection: null,
        share_percentage: row.share_bps === undefined ? '' : sessionBpsText(row.share_bps) })) }];
  });
  const customerId = attempt.kind === 'record' ? attempt.body.customer_id : state.customerId;
  const lines = missing.length ? [...state.drafts.lines, ...missing] : state.drafts.lines;
  const blankDraft = state.drafts.lines.length === 0 && state.drafts.recorder_membership_id == null && state.drafts.occurred_at === undefined;
  const restoreHeader = replaceVisit || sameAttempt || missing.length > 0 || blankDraft;
  return { ...state, sessionId, customerId, customer: state.customer?.id === customerId ? state.customer : null,
    drafts: restoreHeader ? withAttemptHeader(state.drafts, attempt, lines) : state.drafts };
}
// 403 FORBIDDEN على زيارة محفوظة يعني العضوية القديمة ما عدتش صالحة؛ نسيبها عشان الاختيار يفتح على عضوية تانية.
function releaseForbiddenRecorder(state: SessionRecordingResult, error: unknown, status: unknown): SessionRecordingResult {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (status !== 403 || code !== 'FORBIDDEN' || state.sessionId === null || state.drafts.recorder_membership_id == null) return state;
  return { ...state, drafts: { ...state.drafts, recorder_membership_id: null } };
}
// مظروف PARTIAL قديم من غير occurredAt ما يتفسّرش «دلوقتي»؛ التصحيح يتقفل لحد ما الزيارة تتنساب.
// الوقت المعروف ييجي من الزيارة المحمّلة أو من المظروف بس؛ drafts.occurred_at ممكن يكون وقت كتبته المسجّلة، مش وقت الزيارة.
function applyPartialEntry(state: SessionRecordingResult, entry: Extract<SessionJournalEnvelope, { state: 'PARTIAL' }>): SessionRecordingResult {
  const seeded = entry.occurredAt && !state.session ? entry.occurredAt : undefined;
  const drafts = seeded !== undefined && seeded !== state.drafts.occurred_at ? { ...state.drafts, occurred_at: seeded } : state.drafts;
  return { ...state, sessionId: entry.sessionId, drafts, visitTimeUnknown: (state.session?.occurred_at ?? entry.occurredAt) === undefined };
}
function failedResult(state: SessionRecordingResult, attempt: SessionAttempt, error: unknown): SessionRecordingResult {
  const envelope = errorEnvelope.safeParse(error);
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const details = envelope.success ? envelope.data.details : undefined;
  const parsed = rejectedServiceLine.array().min(1).safeParse(details && typeof details === 'object' && 'rejected_lines' in details ? details.rejected_lines : undefined);
  const limitRows = !(error instanceof SessionSavedDisplayFailure) && !sessionAttemptUnresolved(error)
    && status === 422 && envelope.success && envelope.data.code === 'SESSION_DISCOUNT_ABOVE_LIMIT' && parsed.success
    ? indexedRejections(attempt, parsed.data) : null;
  // إنشاء مرفوض يحتفظ بكل السطور؛ الإلحاق المرفوض يبني المرفوض بس عشان السطر المقبول اللي اتشال ما يتحسبش ناقص.
  const wantedIds = limitRows && attempt.kind === 'append' ? limitRows.map((row) => row.localId) : attempt.rowIds;
  state = recoverAttempt(state, attempt, wantedIds);
  if (error instanceof SessionSavedDisplayFailure) return { ...state, attempt: null,
    sessionId: attempt.kind === 'append' ? attempt.sessionId : error.sessionId ?? null, feedback: { kind: 'SAVED_DISPLAY_FAILED' } };
  if (sessionAttemptUnresolved(error)) return { ...state, attempt, feedback: { kind: 'UNRESOLVED' } };
  if (limitRows) {
    const drafts = rejectionSnapshots(state.drafts, limitRows);
    return { ...state, attempt: null, rejected: limitRows, addedLineIds: [],
      drafts: attempt.kind === 'record' ? drafts : retainRejected(drafts, limitRows),
      session: attempt.kind === 'record' ? null : state.session,
      sessionId: attempt.kind === 'record' ? null : attempt.sessionId, feedback: { kind: 'ALL_REJECTED' } };
  }
  return releaseForbiddenRecorder({ ...state, attempt: null, rejected: [], addedLineIds: [], feedback: { kind: 'ERROR', error, refreshScope: status === 401 || status === 403 } }, error, status);
}

export function transitionSessionRecordingResult(state: SessionRecordingResult, event: SessionResultEvent): SessionRecordingResult {
  if (event.type === 'FAILED') return failedResult(state, event.attempt, event.error);
  if (event.type === 'JOURNAL') {
    const entry = event.entry;
    const preserveVisit = !!event.persistenceWarning && !!state.sessionId;
    if (preserveVisit && entry?.state === 'PENDING' && (entry.attempt.kind === 'record' || entry.attempt.sessionId !== state.sessionId))
      return { ...state, persistenceWarning: event.persistenceWarning ?? null, feedback: { kind: 'NOT_PERSISTED' } };
    const clearedPendingVisit = !entry && !event.persistenceWarning && journalDependent(state);
    const clearUnknownVisit = !entry && !event.persistenceWarning && state.visitTimeUnknown && !state.session;
    if (!preserveVisit && (clearedPendingVisit || clearUnknownVisit || (entry?.state === 'PARTIAL' && entry.sessionId !== state.sessionId))) state = emptySessionRecordingResult(state.customer);
    state = { ...state, persistenceWarning: event.persistenceWarning ?? null };
    if (entry?.state === 'PARTIAL' && !preserveVisit) state = applyPartialEntry(state, entry);
    if (entry?.state === 'PENDING') return { ...recoverAttempt(state, entry.attempt, entry.attempt.rowIds, true), attempt: entry.attempt,
      persistenceWarning: event.persistenceWarning ?? null, feedback: { kind: event.inFlight ? 'SAVING' : 'UNRESOLVED' } };
    if (entry?.state === 'EXPIRED' || entry?.state === 'SAVED_DISPLAY_FAILED') return { ...state, attempt: null,
      sessionId: preserveVisit ? state.sessionId : entry.sessionId ?? state.sessionId, feedback: { kind: entry.state } };
    if (event.persistenceWarning) return { ...state, attempt: null, feedback: warnedFeedback(state) };
    const feedback = ['NOT_PERSISTED', 'SAVING', 'UNRESOLVED'].includes(state.feedback.kind)
      ? { kind: state.session ? state.rejected.length ? 'PARTIAL' as const : 'COMPLETE' as const : 'IDLE' as const } : state.feedback;
    return { ...state, attempt: null, feedback };
  }
  const response = event.response, rejected = indexedRejections(event.attempt, response.rejected_lines);
  state = recoverAttempt(state, event.attempt, rejected.map((row) => row.localId));
  return { ...state, session: response.session, sessionId: response.session.id, attempt: null, rejected,
    customerId: response.session.customer.id, customer: state.customer?.id === response.session.customer.id ? state.customer : { id: response.session.customer.id, name: response.session.customer.name, phone: response.session.customer.phone_masked },
    persistenceWarning: event.persistenceWarning ?? null, visitTimeUnknown: false,
    addedLineIds: (event.type === 'APPENDED' ? event.response.added_lines : response.session.lines).map((line) => line.id),
    drafts: retainRejected(rejectionSnapshots(state.drafts, rejected), rejected), feedback: { kind: response.outcome } };
}

export function sessionLeaveFeedback(error: unknown): SessionFeedback {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : error instanceof Error ? error.message : undefined;
  if (code === 'SESSION_ATTEMPT_NOT_PERSISTED') return { kind: 'NOT_PERSISTED' };
  if (code === 'SESSION_ATTEMPT_UNRESOLVED') return { kind: 'UNRESOLVED' };
  return { kind: 'ERROR', error, refreshScope: false };
}

export function sessionResultCommand(state: SessionRecordingResult, lines: SessionAttemptCommand['body']['lines']): SessionAttemptCommand {
  if (state.visitTimeUnknown) throw new Error('SESSION_VISIT_TIME_UNKNOWN');
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

// مظروف PARTIAL قديم من غير وقت مالوش زر في النتيجة المحفوظة؛ الخروج يمسح الزيارة ويسيب الزبونة.
export function leaveUnknownVisit(state: SessionRecordingResult, journal: Pick<SessionAttemptJournal, 'leaveVisit'>): SessionRecordingResult {
  if (!state.visitTimeUnknown) throw new Error('SESSION_VISIT_TIME_KNOWN');
  journal.leaveVisit();
  return emptySessionRecordingResult(state.customer);
}
