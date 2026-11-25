'use client';
import type { GrantStaffAccessInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useGrantEmployeeAccess } from '../api/use-grant-employee-access';
import { staffAccessDefaults, staffAccessResolver } from '../model/staff-access-form-schema';
import { EmployeeAccessFields } from './employee-access-fields';

type GrantFormProps = {
  companyId: string;
  businessId: string;
  employeeId: string;
  onClose: () => void;
};

export function EmployeeAccessGrantForm(props: GrantFormProps) {
  const locale = useLocale();
  const save = useGrantEmployeeAccess(props.companyId, props.businessId, props.employeeId);
  const { onClose } = props;
  const form = useForm<GrantStaffAccessInput>({
    resolver: staffAccessResolver,
    defaultValues: staffAccessDefaults,
  });
  return (
    <ModalDialog
      title={t(locale, 'staff.giveAccessTitle')}
      pending={save.isPending}
      onClose={onClose}
      className="max-w-lg"
    >
      <form onSubmit={form.handleSubmit((body) => save.mutate(body))} className="flex flex-col gap-3">
        <EmployeeAccessFields form={form} />
        {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
        {save.isSuccess ? <p>{t(locale, 'staff.grantedMessage')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t(locale, 'staff.grantAccess')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'staff.closeDialog')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
