'use client';

import type { CommissionStatementEmployee, CommissionStatementReturnInput } from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { statementFailure } from '../model/statement-messages';
import type { StatementPick } from './statement-actions';
import { StatementFailureNotice } from './statement-failure-notice';
import { StatementReturnForm } from './statement-return-form';

const NS = 'commissionStatementScreen';

const TEXT: Record<StatementPick, { title: MessageKey; body: MessageKey }> = {
  generate: { title: `${NS}.generateTitle`, body: `${NS}.generateBody` },
  review: { title: `${NS}.reviewTitle`, body: `${NS}.reviewBody` },
  return: { title: `${NS}.returnTitle`, body: `${NS}.returnBody` },
  approve: { title: `${NS}.approveTitle`, body: `${NS}.approveBody` },
};

/** النص المقروء لرد السيرفر الأخير في الحوار، أو null قبل أي محاولة. */
function failureOf(error: unknown, locale: Locale, pick: StatementPick) {
  if (error === null || error === undefined) return null;
  return statementFailure(error, locale, pick === 'approve' ? 'approve' : undefined);
}

/**
 * حوار تأكيد أمر على الكشف: العنوان والشرح، وفورم السبب في الإرجاع، ورد السيرفر المقروء لو الأمر اترفض.
 * الحوار مفتوح لحد ما الأمر ينجح، والصفحة هي اللي بتقفله؛ وهو مقفول للإلغاء طول ما الأمر شغّال.
 */
export function StatementCommandDialog(props: {
  pick: StatementPick;
  pending: boolean;
  error: unknown;
  employees: readonly CommissionStatementEmployee[];
  onConfirm(returnBody?: CommissionStatementReturnInput): void;
  onClose(): void;
  onReload(): void;
}) {
  const { pick, pending, error, employees, onConfirm, onClose, onReload } = props;
  const locale = useLocale();
  const failure = failureOf(error, locale, pick);
  const notice =
    failure === null ? null : <StatementFailureNotice failure={failure} employees={employees} onReload={onReload} />;
  return (
    <ModalDialog title={t(locale, TEXT[pick].title)} pending={pending} onClose={onClose}>
      <p>{t(locale, TEXT[pick].body)}</p>
      {pick === 'return' ? (
        <StatementReturnForm pending={pending} onSubmit={onConfirm} onCancel={onClose}>
          {notice}
        </StatementReturnForm>
      ) : (
        <>
          {notice}
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => onConfirm()}>
              {pending ? t(locale, `${NS}.working`) : t(locale, `${NS}.confirm`)}
            </Button>
            <Button variant="outline" disabled={pending} onClick={onClose}>
              {t(locale, `${NS}.cancel`)}
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
