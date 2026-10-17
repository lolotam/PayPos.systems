'use client';
import type { EditServiceLineInput } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useEditServiceLine, type EditServiceLineResult } from '../api/use-edit-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { classifyEditError, resolveEditLine, type EditLimitDetails, type EditLineFormInput } from '../model/edit-service-line-values';
import { EditServiceLineFields } from './edit-service-line-fields';
import { EditServiceLinePreview } from './edit-service-line-preview';

export type EditableServiceLine = { id: string; price: string; discount: string; net: string; revision: number };
export type EditServiceLineFormProps = {
  scope: SessionServiceScope; sessionId: string; line: EditableServiceLine; online: boolean;
  figuresKnown?: boolean; retryStaleOnce?: boolean;
  onSaved: (result: EditServiceLineResult) => void; onStale: () => Promise<number | null> | undefined; onForbidden: (message: string) => void;
  onAccessDenied?: (message: string) => void; onClose: () => void;
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
  const pending = mutation.isPending;
  const blocked = pending || refreshing;
  const submit = form.handleSubmit(async (body) => {
    if (!props.online || pending || refreshing) return;
    setRoot(null);
    setLimit(null);
    try {
      props.onSaved(await mutation.mutateAsync({ sessionId: props.sessionId, lineId: props.line.id, body }));
    } catch (error) {
      const stale = applyEditError(error, locale, form, setRoot, setLimit, setMemberships, props);
      if (!stale) return;
      setRefreshing(true);
      try {
        await adoptRefetchedRevision(props.onStale, form.getValues('expected_revision'), (revision) => { form.setValue('expected_revision', revision); });
      } finally {
        setRefreshing(false);
      }
    }
  });
  return <form className="grid gap-3 text-start" onSubmit={(event) => { void submit(event); }} onKeyDown={submitOnEnter(props.online, blocked)}>
    {root ? <p role="alert">{root}</p> : null}
    <EditServiceLineFields form={form} locale={locale} memberships={memberships} online={props.online} pending={blocked} onClose={props.onClose} />
    <EditServiceLinePreview locale={locale} line={props.line} price={watched.price ?? ''} kind={watched.discount_kind ?? 'AMOUNT'} discount={watched.discount_value ?? ''} limit={limit} figuresKnown={known} />
  </form>;
}
