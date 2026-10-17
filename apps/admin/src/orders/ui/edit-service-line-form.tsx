'use client';
import type { EditServiceLineInput, ServiceSessionDayPage } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useEditServiceLine } from '../api/use-edit-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { classifyEditError, resolveEditLine, type EditLimitDetails, type EditLineFormInput } from '../model/edit-service-line-values';
import { EditServiceLineFields } from './edit-service-line-fields';
import { EditServiceLinePreview } from './edit-service-line-preview';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
export type EditServiceLineFormProps = {
  scope: SessionServiceScope; sessionId: string; line: DayLine; online: boolean;
  onSaved: () => void; onStale: () => void; onForbidden: (message: string) => void; onClose: () => void;
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

function applyEditError(error: unknown, locale: Locale, form: UseFormReturn<EditLineFormInput, unknown, EditServiceLineInput>, setRoot: (message: string) => void, setLimit: (details: EditLimitDetails | null) => void, setMemberships: (ids: string[]) => void, setStaleSeen: Dispatch<SetStateAction<boolean>>, props: EditServiceLineFormProps) {
  const failure = classifyEditError(error, locale);
  if (failure.kind === 'stale') { setRoot(failure.message); setStaleSeen(true); props.onStale(); return; }
  if (failure.kind === 'forbidden') { props.onForbidden(failure.message); props.onClose(); return; }
  if (failure.kind === 'field') { form.setError(failure.field, { message: failure.message }); return; }
  if (failure.kind === 'limit') { setLimit(failure.details); setRoot(failure.message); return; }
  if (failure.kind === 'membership') { setMemberships(failure.ids); setRoot(failure.message); return; }
  setRoot(failure.message);
}

export function EditServiceLineForm(props: EditServiceLineFormProps) {
  const locale = useLocale();
  const mutation = useEditServiceLine(props.scope);
  const [root, setRoot] = useState<string | null>(null);
  const [limit, setLimit] = useState<EditLimitDetails | null>(null);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [staleSeen, setStaleSeen] = useState(false);
  const form = useForm<EditLineFormInput, unknown, EditServiceLineInput>({
    resolver: resolveEditLine,
    defaultValues: { price: props.line.price, discount_kind: 'AMOUNT', discount_value: props.line.discount, reason: '', expected_revision: props.line.revision, editor_membership_id: '' },
  });
  const { setValue, control } = form;
  // المراجعة بتتجمد على قيمة الفتح؛ بتتقدم بس بعد 409 عشان إعادة الجلب في الخلفية ما تعدّيش مقارنة النسخة.
  useEffect(() => { if (staleSeen) setValue('expected_revision', props.line.revision); }, [staleSeen, props.line.revision, setValue]);
  const watched = useWatch({ control });
  const pending = mutation.isPending;
  const submit = form.handleSubmit(async (body) => {
    if (!props.online || pending) return;
    setRoot(null);
    setLimit(null);
    try {
      await mutation.mutateAsync({ sessionId: props.sessionId, lineId: props.line.id, body });
      props.onSaved();
    } catch (error) { applyEditError(error, locale, form, setRoot, setLimit, setMemberships, setStaleSeen, props); }
  });
  return <form className="grid gap-3 text-start" onSubmit={(event) => { void submit(event); }} onKeyDown={submitOnEnter(props.online, pending)}>
    {root ? <p role="alert">{root}</p> : null}
    <EditServiceLineFields form={form} locale={locale} memberships={memberships} online={props.online} pending={pending} onClose={props.onClose} />
    <EditServiceLinePreview locale={locale} line={props.line} price={watched.price ?? ''} kind={watched.discount_kind ?? 'AMOUNT'} discount={watched.discount_value ?? ''} limit={limit} />
  </form>;
}
