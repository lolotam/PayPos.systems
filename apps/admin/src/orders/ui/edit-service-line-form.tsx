'use client';
import type { EditServiceLineInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useState, type KeyboardEvent } from 'react';
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

// الإغلاق وقت النتيجة المجهولة بيضيّع مفتاح المحاولة والمراجعة. القفل يفضل لحد ما الحفظ يخلّص بنتيجة معروفة.
async function saveLineEdit(input: {
  body: EditServiceLineInput; props: EditServiceLineFormProps; locale: Locale;
  form: UseFormReturn<EditLineFormInput, unknown, EditServiceLineInput>;
  mutate: (attempt: { sessionId: string; lineId: string; body: EditServiceLineInput }) => Promise<EditServiceLineResult>;
  setRoot: (message: string | null) => void; setLimit: (details: EditLimitDetails | null) => void;
  setMemberships: (ids: string[]) => void; setRefreshing: (value: boolean) => void; setUncertain: (value: boolean) => void;
}): Promise<boolean> {
  try {
    input.props.onSaved(await input.mutate({ sessionId: input.props.sessionId, lineId: input.props.line.id, body: input.body }));
    return true;
  } catch (error) {
    const adopted = revisionAfterFailedRetry(error);
    if (adopted !== null) input.form.setValue('expected_revision', adopted);
    const known = editOutcomeKnown(error);
    if (!known) input.setUncertain(true);
    const stale = applyEditError(error, input.locale, input.form, input.setRoot, input.setLimit, input.setMemberships, input.props);
    if (!known || !stale) return known;
    input.setRefreshing(true);
    try {
      await adoptRefetchedRevision(input.props.onStale, input.form.getValues('expected_revision'), (revision) => { input.form.setValue('expected_revision', revision); });
    } finally { input.setRefreshing(false); }
    return true;
  }
}

export function EditServiceLineForm(props: EditServiceLineFormProps) {
  const locale = useLocale();
  const known = props.figuresKnown !== false;
  const mutation = useEditServiceLine(props.scope, props.retryStaleOnce === true);
  const [root, setRoot] = useState<string | null>(null);
  const [limit, setLimit] = useState<EditLimitDetails | null>(null);
  const [memberships, setMemberships] = useState<string[]>([]);
  const form = useForm<EditLineFormInput, unknown, EditServiceLineInput>({
    resolver: resolveEditLine,
    defaultValues: { price: known ? props.line.price : '', discount_kind: 'AMOUNT', discount_value: known ? props.line.discount : '', reason: '', expected_revision: props.line.revision, editor_membership_id: '' },
  });
  const { control } = form;
  const watched = useWatch({ control });
  const [refreshing, setRefreshing] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [visitLock] = useState(() => ({ held: false }));
  const pending = mutation.isPending;
  const blocked = pending || refreshing;
  const submit = form.handleSubmit(async (body) => {
    if (!props.online || pending || refreshing) return;
    // إعادة الحفظ بعد نتيجة مجهولة ما بترفعش العداد تاني. finally بينزّله لما النتيجة تبقى معروفة حتى لو المحرر اتفك.
    raiseVisitLock(visitLock, props.onRequestStart);
    setRoot(null);
    setLimit(null);
    setUncertain(false);
    let release = true;
    try {
      release = await saveLineEdit({
        body, props, locale, form, mutate: (attempt) => mutation.mutateAsync(attempt),
        setRoot, setLimit, setMemberships, setRefreshing, setUncertain,
      });
    } finally {
      if (release) dropVisitLock(visitLock, props.onRequestEnd);
    }
  });
  return <form className="grid gap-3 text-start" onSubmit={(event) => { void submit(event); }} onKeyDown={submitOnEnter(props.online, blocked)}>
    {root ? <p role="alert">{root}</p> : null}
    {uncertain ? <p>{t(locale, 'serviceLineEdit.outcomeUnknown')}</p> : null}
    <EditServiceLineFields form={form} locale={locale} memberships={memberships} online={props.online} pending={blocked} closeDisabled={props.closeDisabled === true} onClose={props.onClose} />
    <EditServiceLinePreview locale={locale} line={props.line} price={watched.price ?? ''} kind={watched.discount_kind ?? 'AMOUNT'} discount={watched.discount_value ?? ''} limit={limit} figuresKnown={known} />
  </form>;
}
