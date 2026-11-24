'use client';

import type {
  CommissionStatementEmployee,
  CommissionStatementReturnInput,
  MarkCommissionStatementPaidInput,
} from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { statementFailure } from '../model/statement-messages';
import type { StatementPick } from './statement-actions';
import { StatementFailureNotice } from './statement-failure-notice';
import { StatementPayForm } from './statement-pay-form';
import { StatementReturnForm } from './statement-return-form';

const NS = 'commissionStatementScreen';

const TEXT: Record<StatementPick, { title: MessageKey; body: MessageKey }> = {
  generate: { title: `${NS}.generateTitle`, body: `${NS}.generateBody` },
  review: { title: `${NS}.reviewTitle`, body: `${NS}.reviewBody` },
  return: { title: `${NS}.returnTitle`, body: `${NS}.returnBody` },
  approve: { title: `${NS}.approveTitle`, body: `${NS}.approveBody` },
  pay: { title: `${NS}.payTitle`, body: `${NS}.payBody` },
};

/** اللي فورم الحوار بيسلّمه عند التأكيد: سبب الإرجاع أو بيانات الصرف. */
export type DialogInput = CommissionStatementReturnInput | MarkCommissionStatementPaidInput;

/** النص المقروء لرد السيرفر الأخير في الحوار، أو null قبل أي محاولة. */
function failureOf(error: unknown, locale: Locale) {
  return error === null || error === undefined ? null : statementFailure(error, locale);
}

/**
 * حوار تأكيد أمر على الكشف: العنوان والشرح، وفورم السبب في الإرجاع وفورم بيانات الصرف، ورد السيرفر المقروء لو الأمر اترفض.
 * الحوار مفتوح لحد ما الأمر ينجح، والصفحة هي اللي بتقفله؛ وهو مقفول للإلغاء طول ما الأمر شغّال.
 */
export function StatementCommandDialog(props: {
  pick: StatementPick;
  pending: boolean;
  error: unknown;
  employees: readonly CommissionStatementEmployee[];
  onConfirm(input?: DialogInput): void;
  onClose(): void;
  onReload(): void;
}) {
  const { pick, pending, error, employees, onConfirm, onClose, onReload } = props;
  const locale = useLocale();
  const failure = failureOf(error, locale);
  const notice =
    failure === null ? null : <StatementFailureNotice failure={failure} employees={employees} onReload={onReload} />;
  return (
    <ModalDialog title={t(locale, TEXT[pick].title)} pending={pending} onClose={onClose}>
      <p>{t(locale, TEXT[pick].body)}</p>
      {pick === 'return' ? (
        <StatementReturnForm pending={pending} onSubmit={onConfirm} onCancel={onClose}>
          {notice}
        </StatementReturnForm>
      ) : null}
      {pick === 'pay' ? (
        <StatementPayForm employees={employees} pending={pending} onSubmit={onConfirm} onCancel={onClose}>
          {notice}
        </StatementPayForm>
      ) : null}
      {pick !== 'return' && pick !== 'pay' ? (
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
      ) : null}
    </ModalDialog>
  );
}
