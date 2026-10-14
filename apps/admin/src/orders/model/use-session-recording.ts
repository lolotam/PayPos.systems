'use client';
import { discountPercentage, sessionMoney } from '@pospay/contracts';
import { normalizeKwdInput } from '@pospay/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppendServiceSessionLines } from '../api/use-append-service-session-lines';
import { useRecordServiceSession } from '../api/use-record-service-session';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionAttempt, SessionAttemptCommand, SessionAttemptRuntime } from './session-attempt';
import { createSessionAttemptJournal, type SessionAttemptJournal } from './session-attempt-journal';
import { normalizeSessionPercent, sessionPerformerInputs, type SessionDraftForm, type SessionDraftLine } from './session-drafts';
import {
  emptySessionRecordingResult, sessionLeaveFeedback, sessionResultCommand, sessionResultFrozen, transitionSessionRecordingResult,
  type SessionRecordingResult, type SessionResultEvent,
} from './session-recording-result';

type RecordMutation = ReturnType<typeof useRecordServiceSession>;
type AppendMutation = ReturnType<typeof useAppendServiceSessionLines>;
type Dispatch = (event: SessionResultEvent) => void;
type Mirror = { current: SessionRecordingResult };

export type SessionRecordingController = {
  result: SessionRecordingResult;
  journal: SessionAttemptJournal | null;
  submit: (drafts: SessionDraftForm) => Promise<void>;
  retry: () => Promise<void>;
  selectCustomer: (customer: SessionRecordingResult['customer']) => void;
  replaceResult: (result: SessionRecordingResult) => void;
};

const pendingJournal: SessionAttemptJournal = {
  get scope() { return null; },
  get persistenceWarning() { return null; },
  read: () => null,
  changeScope() {},
  leaveVisit() { throw new Error('SESSION_ATTEMPT_UNAVAILABLE'); },
  begin() { throw new Error('SESSION_ATTEMPT_UNAVAILABLE'); },
  run: () => Promise.reject(new Error('SESSION_ATTEMPT_UNAVAILABLE')),
  dispose() {},
};

function sessionCommandLines(lines: SessionDraftLine[]): SessionAttemptCommand['body']['lines'] {
  return lines.map((line) => ({
    service_id: line.service_id,
    price: sessionMoney.parse(normalizeKwdInput(line.price)),
    discount: line.discount_kind === 'PERCENT'
      ? { kind: 'PERCENT' as const, bps: discountPercentage.parse(normalizeSessionPercent(line.discount_percentage)) }
      : { kind: 'AMOUNT' as const, amount: sessionMoney.parse(normalizeKwdInput(line.discount_amount)) },
    performers: sessionPerformerInputs(line),
  }));
}

// المرآة بتطبّق الانتقال فورًا: setState بيتأجل، وقراءة الدفتر بين النداءين كانت بتشوف SAVING وتمسح الرأس.
function applyRecordingEvent(mirror: Mirror, setState: (next: SessionRecordingResult) => void, event: SessionResultEvent) {
  const next = transitionSessionRecordingResult(mirror.current, event);
  mirror.current = next;
  setState(next);
  return next;
}

function patchCustomer(mirror: Mirror, setState: (next: SessionRecordingResult) => void, customer: SessionRecordingResult['customer']) {
  const current = mirror.current;
  if (sessionResultFrozen(current) || current.sessionId || current.customer === customer) return;
  const next = { ...current, customer, customerId: customer?.id ?? null };
  mirror.current = next;
  setState(next);
}

// الرفض بيرجّع سطور الحالة مش جسم الطلب؛ المسودة اللي اتبعتت تتثبّت قبل PENDING عشان التصحيح ما يرجعش للقيمة القديمة.
function adoptSubmittedDrafts(mirror: Mirror, setState: (next: SessionRecordingResult) => void, drafts: SessionDraftForm) {
  if (mirror.current.drafts === drafts) return;
  const next = { ...mirror.current, drafts };
  mirror.current = next;
  setState(next);
}

function noteBeginFailure(journal: SessionAttemptJournal, dispatch: Dispatch, error: unknown) {
  const feedback = sessionLeaveFeedback(error);
  if (feedback.kind === 'NOT_PERSISTED') {
    dispatch({ type: 'JOURNAL', entry: journal.read(), persistenceWarning: 'NOT_PERSISTED' });
    return;
  }
  if (feedback.kind === 'UNRESOLVED') return;
  throw error;
}

async function publishSettled(journal: SessionAttemptJournal, attempt: SessionAttempt, dispatch: Dispatch, record: RecordMutation, append: AppendMutation) {
  if (attempt.kind === 'record') {
    const settled = await record.mutateAsync(attempt);
    dispatch({ type: 'RECORDED', attempt, response: settled.data, persistenceWarning: journal.persistenceWarning });
    return;
  }
  const settled = await append.mutateAsync(attempt);
  dispatch({ type: 'APPENDED', attempt, response: settled.data, persistenceWarning: journal.persistenceWarning });
}

async function runAttempt(journal: SessionAttemptJournal, attempt: SessionAttempt, dispatch: Dispatch, record: RecordMutation, append: AppendMutation) {
  dispatch({ type: 'JOURNAL', entry: journal.read(), inFlight: true, persistenceWarning: journal.persistenceWarning });
  try {
    await publishSettled(journal, attempt, dispatch, record, append);
  } catch (error) {
    dispatch({ type: 'FAILED', attempt, error });
  }
  // النتيجة تتطبق قبل القراءة: null والزيارة لسه SAVING بيمسح recorder_membership_id و occurred_at.
  dispatch({ type: 'JOURNAL', entry: journal.read(), persistenceWarning: journal.persistenceWarning });
}

async function submitRecording(journal: SessionAttemptJournal, mirror: Mirror, drafts: SessionDraftForm, dispatch: Dispatch, record: RecordMutation, append: AppendMutation, setState: (next: SessionRecordingResult) => void) {
  try {
    const command = sessionResultCommand({ ...mirror.current, drafts }, sessionCommandLines(drafts.lines));
    const attempt = journal.begin(command, drafts.lines.map((line) => line.local_id));
    adoptSubmittedDrafts(mirror, setState, drafts);
    await runAttempt(journal, attempt, dispatch, record, append);
  } catch (error) {
    noteBeginFailure(journal, dispatch, error);
  }
}

function openRecordingJournal(scopeRef: { current: SessionServiceScope }, runtime: { current: SessionAttemptRuntime }, setJournal: (journal: SessionAttemptJournal) => void, dispatch: Dispatch) {
  const created = createSessionAttemptJournal(scopeRef.current, runtime.current);
  setJournal(created);
  dispatch({ type: 'JOURNAL', entry: created.read(), persistenceWarning: created.persistenceWarning });
  return () => { created.dispose(); };
}

export function useSessionRecording(scope: SessionServiceScope): SessionRecordingController {
  const runtime = useRef<SessionAttemptRuntime>({ now: () => Date.now(), newId: () => crypto.randomUUID() });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const scopeKey = `${scope.companyId}:${scope.businessId}:${scope.branchId}:${scope.userId}`;
  const [journal, setJournal] = useState<SessionAttemptJournal | null>(null);
  const [state, setState] = useState(emptySessionRecordingResult);
  const mirror = useRef(state);
  const dispatch = useCallback((event: SessionResultEvent) => applyRecordingEvent(mirror, setState, event), []);
  const active = journal ?? pendingJournal;
  const record = useRecordServiceSession(active);
  const append = useAppendServiceSessionLines(active);
  useEffect(() => openRecordingJournal(scopeRef, runtime, setJournal, dispatch), [scopeKey, dispatch]);
  const selectCustomer = useCallback((customer: SessionRecordingResult['customer']) => patchCustomer(mirror, setState, customer), []);
  const replaceResult = useCallback((next: SessionRecordingResult) => { mirror.current = next; setState(next); }, []);
  const submit = useCallback((drafts: SessionDraftForm) => (
    journal ? submitRecording(journal, mirror, drafts, dispatch, record, append, setState) : Promise.resolve()
  ), [append, dispatch, journal, record]);
  const retry = useCallback(() => {
    const attempt = mirror.current.attempt;
    return journal && attempt && mirror.current.feedback.kind === 'UNRESOLVED'
      ? runAttempt(journal, attempt, dispatch, record, append) : Promise.resolve();
  }, [append, dispatch, journal, record]);
  return { result: state, journal, submit, retry, selectCustomer, replaceResult };
}
