'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useFormContext } from 'react-hook-form';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeContractFields } from './employee-contract-fields';
import { EmployeeNameFields } from './employee-name-fields';
import { EmployeeNumberField } from './employee-number-field';
import { EmployeePlacementFields } from './employee-placement-fields';
import {
  EmployeeRecoveryEmailField,
  newRecoveryEmailOptions,
} from './employee-recovery-email-field';
import { EmployeeFieldCell } from './employee-field-cell';

type CreateEmployeeSectionsProps = {
  branches: readonly WorkspaceBranch[];
  numberShown: boolean;
  numberHidden: boolean;
  numberMessage: string | null;
};

/** قسما نموذج إنشاء الموظف على شبكة الـ12 عمودًا؛ ترتيب الحقول في الصفحة هو نفسه ترتيب التبويب. */
export function CreateEmployeeSections({
  branches,
  numberShown,
  numberHidden,
  numberMessage,
}: CreateEmployeeSectionsProps) {
  const locale = useLocale();
  const { register, formState } = useFormContext<CreateEmployeeInput>();
  return (
    <>
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">{t(locale, 'staff.sectionIdentity')}</h2>
        <div className="grid grid-cols-12 gap-4">
          <EmployeeNameFields grid />
          <EmployeeFieldCell grid span={12}>
            <EmployeeRecoveryEmailField
              field={register('recovery_email', newRecoveryEmailOptions)}
              invalid={formState.errors.recovery_email !== undefined}
            />
          </EmployeeFieldCell>
        </div>
      </section>
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">{t(locale, 'staff.sectionEmployment')}</h2>
        <div className="grid grid-cols-12 gap-4">
          <EmployeePlacementFields branches={branches} grid />
          <EmployeeContractFields grid />
          <EmployeeNumberField
            shown={numberShown}
            hidden={numberHidden}
            message={numberMessage}
            grid
          />
        </div>
      </section>
    </>
  );
}
