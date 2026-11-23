'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardFooter } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { CreateEmployeeSections } from './create-employee-sections';

type CreateEmployeeFormCardProps = {
  branches: readonly WorkspaceBranch[];
  /** يعطّل كل الحقول أثناء الحفظ أو فحص الاسم أو ظهور تحذير التكرار. */
  disabled: boolean;
  numberShown: boolean;
  numberHidden: boolean;
  numberMessage: string | null;
};

/** كرت إنشاء الموظف: القسمان داخل fieldset واحد، وزر الإنشاء آخر ما في ذيل الكرت. */
export function CreateEmployeeFormCard({
  branches,
  disabled,
  numberShown,
  numberHidden,
  numberMessage,
}: CreateEmployeeFormCardProps) {
  const locale = useLocale();
  return (
    <Card>
      <fieldset disabled={disabled} className="min-w-0">
        <CardContent className="grid gap-6">
          <CreateEmployeeSections
            branches={branches}
            numberShown={numberShown}
            numberHidden={numberHidden}
            numberMessage={numberMessage}
          />
        </CardContent>
        <CardFooter>
          <Button className="ms-auto" type="submit" disabled={numberHidden}>
            {t(locale, 'staff.create')}
          </Button>
        </CardFooter>
      </fieldset>
    </Card>
  );
}
