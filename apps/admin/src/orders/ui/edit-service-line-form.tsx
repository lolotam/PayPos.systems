'use client';
import type { EditServiceLineInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { editOutcomeKnown, revisionAfterFailedRetry, useEditServiceLine, type EditServiceLineResult } from '../api/use-edit-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { classifyEditError, resolveEditLine, type EditLimitDetails, type EditLineFormInput } from '../model/edit-service-line-values';
import { EditServiceLineFields } from './edit-service-line-fields';
import { EditServiceLinePreview } from './edit-service-line-preview';

export type EditableServiceLine = { id: string; price: string; discount: string; net: string; revision: number };
export type EditServiceLineFormProps = {
  scope: SessionServiceScope; sessionId: string; line: EditableServiceLine; online: boolean;
  figuresKnown?: boolean; retryStaleOnce?: boolean;
  onSaved: (result: EditServiceLineResult) => void; onStale: () => Promise<number | null> | undefined; onForbidden: (message: string) => void;
  onAccessDenied?: (message: string) => void; onRequestStart?: () => void; onRequestEnd?: () => void; closeDisabled?: boolean; onClose: () => void;
};

function submitOnEnter(online: boolean, pending: boolean) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || !online || pending) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target instanceof HTMLSelectElement) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
  };
}

function applyEditError(error: unknown, locale: Locale, form: UseFormReturn<EditLineFormInput, unknown, EditServiceLineInput>, setRoot: (message: string) => void, setLimit: (details: EditLimitDetails | null) => void, setMemberships: (ids: string[]) => void, props: EditServiceLineFormProps) {
  const failure = classifyEditError(error, locale);
  if (failure.kind === 'stale') { setRoot(failure.message); return true; }
  if (failure.kind === 'forbidden') { props.onForbidden(failure.message); props.onClose(); return false; }
  if (failure.kind === 'revoked') { (props.onAccessDenied ?? props.onForbidden)(failure.message); props.onClose(); return false; }
  if (failure.kind === 'field') { form.setError(failure.field, { message: failure.message }); return false; }
  if (failure.kind === 'limit') { setLimit(failure.details); setRoot(failure.message); return false; }
  if (failure.kind === 'membership') { setMemberships(failure.ids); setRoot(failure.message); return false; }
  setRoot(failure.message);
  return false;
}

// المراجعة الجديدة لازم تيجي من جلب الـ 409 نفسه؛ نسخة الكاش اللي وصلت قبل الجلب لسه قديمة.
async function adoptRefetchedRevision(load: EditServiceLineFormProps['onStale'], refused: number, setRevision: (revision: number) => void) {
  const fresh = await load();
  if (typeof fresh === 'number' && fresh > refused) setRevision(fresh);
}

function raiseVisitLock(lock: { held: boolean }, onRequestStart: (() => void) | undefined) {
  if (lock.held) return;
  lock.held = true;
  onRequestStart?.();
}

function dropVisitLock(lock: { held: boolean }, onRequestEnd: (() => void) | undefined) {
  if (!lock.held) return;
  lock.held = false;
  onRequestEnd?.();
}

// إعادة المحاولة التلقائية بتبدّل المراجعة، والمفتاح اتحجز على الجسم ده مش على قيم النموذج.
function replayBody(body: EditServiceLineInput, error: unknown): EditServiceLineInput {
  const adopted = revisionAfterFailedRetry(error);
  return adopted === null ? body : { ...body, expected_revision: adopted };
}

type VisitLock = { held: boolean };
type LockRefs = { lock: { current: VisitLock }; mounted: { current: boolean }; endRef: { current: (() => void) | undefined } };

function useEditLock(onRequestEnd: (() => void) | undefined, uncertain: boolean, pending: boolean): LockRefs {
  const lock = useRef<VisitLock>({ held: false });
  const endRef = useRef(onRequestEnd);
  const mounted = useRef(true);
  const gate = useRef({ uncertain, pending });
  useEffect(() => {
    endRef.current = onRequestEnd;
    gate.current = { uncertain, pending };
  }, [onRequestEnd, uncertain, pending]);
  useEffect(() => {
    const held = lock.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      // طلب معلّق له finally. النتيجة المجهولة المستقرّة مالهاش نهاية غير الفك ده.
      if (gate.current.uncertain && !gate.current.pending) dropVisitLock(held, endRef.current);
    };
  }, []);
  return { lock, mounted, endRef };
}

type EditSaveOutcome = { release: boolean; retain: EditServiceLineInput | null };

async function saveLineEdit(input: {
  body: EditServiceLineInput; props: EditServiceLineFormProps; locale: Locale;
  form: UseFormReturn<EditLineFormInput, unknown, EditServiceLineInput>;
  mutate: (attempt: { sessionId: string; lineId: string; body: EditServiceLineInput }) => Promise<EditServiceLineResult>;
  setRoot: (message: string | null) => void; setLimit: (details: EditLimitDetails | null) => void;
  setMemberships: (ids: string[]) => void; setRefreshing: (value: boolean) => void;
}): Promise<EditSaveOutcome> {
  try {
    input.props.onSaved(await input.mutate({ sessionId: input.props.sessionId, lineId: input.props.line.id, body: input.body }));
    return { release: true, retain: null };
  } catch (error) {
    const retainedBody = replayBody(input.body, error);
    if (retainedBody !== input.body) input.form.setValue('expected_revision', retainedBody.expected_revision);
    const known = editOutcomeKnown(error);
    const stale = applyEditError(error, input.locale, input.form, input.setRoot, input.setLimit, input.setMemberships, input.props);
    if (!known || !stale) return { release: known, retain: known ? null : retainedBody };
    input.setRefreshing(true);
    try {
      await adoptRefetchedRevision(input.props.onStale, input.form.getValues('expected_revision'), (revision) => { input.form.setValue('expected_revision', revision); });
    } catch {
      // فشل جلب المراجعة بعد تعارض معروف ما يسيبش القفل ولا الحقول متجمدة؛ رسالة التعارض اتعرضت فوق.
    } finally { input.setRefreshing(false); }
    return { release: true, retain: null };
  }
}

type CommitControls = LockRefs & {
  props: EditServiceLineFormProps; retain: { current: EditServiceLineInput | null };
  setRoot: (message: string | null) => void; setLimit: (details: EditLimitDetails | null) => void;
  setFrozen: (value: boolean) => void; setUncertain: (value: boolean) => void;
};

async function commitLineEdit(controls: CommitControls, attempt: {
  body: EditServiceLineInput; locale: Locale; form: UseFormReturn<EditLineFormInput, unknown, EditServiceLineInput>;
  mutate: (next: { sessionId: string; lineId: string; body: EditServiceLineInput }) => Promise<EditServiceLineResult>;
  setMemberships: (ids: string[]) => void; setRefreshing: (value: boolean) => void;
}): Promise<void> {
  raiseVisitLock(controls.lock.current, controls.props.onRequestStart);
  controls.setRoot(null);
  controls.setLimit(null);
  controls.setFrozen(true);
  const outcome = await saveLineEdit({
    body: attempt.body, props: controls.props, locale: attempt.locale, form: attempt.form, mutate: attempt.mutate,
    setRoot: controls.setRoot, setLimit: controls.setLimit, setMemberships: attempt.setMemberships, setRefreshing: attempt.setRefreshing,
  });
  if (outcome.release || !controls.mounted.current) {
    controls.retain.current = null;
    if (controls.mounted.current) { controls.setFrozen(false); controls.setUncertain(false); }
    dropVisitLock(controls.lock.current, controls.endRef.current);
    return;
  }
  controls.retain.current = outcome.retain;
  controls.setUncertain(true);
}

function submitReplay(event: FormEvent<HTMLFormElement>, replay: EditServiceLineInput | null, send: (body: EditServiceLineInput) => void, submit: (event: FormEvent<HTMLFormElement>) => void) {
  if (!replay) { void submit(event); return; }
  event.preventDefault();
  send(replay);
}

export function EditServiceLineForm(props: EditServiceLineFormProps) {
  const locale = useLocale();
  const known = props.figuresKnown !== false;
  const mutation = useEditServiceLine(props.scope, props.retryStaleOnce === true);
  const [root, setRoot] = useState<string | null>(null);
  const [limit, setLimit] = useState<EditLimitDetails | null>(null);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const retain = useRef<EditServiceLineInput | null>(null);
  const { lock, mounted, endRef } = useEditLock(props.onRequestEnd, uncertain, mutation.isPending);
  const form = useForm<EditLineFormInput, unknown, EditServiceLineInput>({
    resolver: resolveEditLine,
    defaultValues: { price: known ? props.line.price : '', discount_kind: 'AMOUNT', discount_value: known ? props.line.discount : '', reason: '', expected_revision: props.line.revision, editor_membership_id: '' },
  });
  const watched = useWatch({ control: form.control });
  const pending = mutation.isPending;
  const blocked = pending || refreshing;
  const send = (body: EditServiceLineInput) => {
    if (!props.online || pending || refreshing) return;
    void commitLineEdit(
      { lock, mounted, endRef, props, retain, setRoot, setLimit, setFrozen, setUncertain },
      { body, locale, form, mutate: (attempt) => mutation.mutateAsync(attempt), setMemberships, setRefreshing },
    );
  };
  return <form className="grid gap-3 text-start" onSubmit={(event) => { submitReplay(event, retain.current, send, (next) => form.handleSubmit(send)(next)); }} onKeyDown={submitOnEnter(props.online, blocked)}>
    {root ? <p role="alert">{root}</p> : null}
    {uncertain ? <p>{t(locale, 'serviceLineEdit.outcomeUnknown')}</p> : null}
    <EditServiceLineFields form={form} locale={locale} memberships={memberships} online={props.online} pending={blocked} frozen={frozen} closeDisabled={props.closeDisabled === true} onClose={props.onClose} />
    <EditServiceLinePreview locale={locale} line={props.line} price={watched.price ?? ''} kind={watched.discount_kind ?? 'AMOUNT'} discount={watched.discount_value ?? ''} limit={limit} figuresKnown={known} />
  </form>;
}
