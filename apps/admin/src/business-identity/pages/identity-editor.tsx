'use client';

import type { UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { OfficialNames } from '../model/changed-official-names';
import { identityFailureMessage } from '../model/identity-failure';
import { OfficialNamesForm } from '../ui/official-names-form';

/**
 * محرر الأسماء الرسمية: النموذج مع رسالة الحفظ ورسالة الخطأ تحته، وحالة المسودة
 * داخلية حتى لا تختفي رسالة الحفظ ما دام المستخدم عدّل بعد الحفظ.
 */
export function IdentityEditor(props: {
  baseline: OfficialNames | null;
  saved: OfficialNames | null;
  namesPending: boolean;
  namesSaved: boolean;
  namesError: unknown;
  onSave: (body: UpdateBusinessIdentityNamesInput) => void;
}) {
  const locale = useLocale();
  const [draftDirty, setDraftDirty] = useState(false);
  return (
    <>
      <OfficialNamesForm
        baseline={props.baseline}
        saved={props.saved}
        pending={props.namesPending}
        onSave={props.onSave}
        onDirtyChange={setDraftDirty}
      />
      {props.namesSaved && !draftDirty ? (
        <p role="status">{t(locale, 'businessIdentity.saved')}</p>
      ) : null}
      {props.namesError ? (
        <p role="alert">{identityFailureMessage(props.namesError, locale)}</p>
      ) : null}
    </>
  );
}
