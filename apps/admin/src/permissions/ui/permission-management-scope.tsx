'use client';
import { t } from '@pospay/i18n';
import { Label, Select } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionManagementScope({
  value,
  businessName,
  onChange,
}: {
  value: string;
  businessName: string;
  onChange: (scope: string) => void;
}) {
  const locale = useLocale();
  return (
    <div>
      <Label htmlFor="permission-management-scope">{t(locale, 'permissions.scope')}</Label>
      <Select
        id="permission-management-scope"
        value={value}
        onValueChange={onChange}
        options={[
          { value: 'company', label: t(locale, 'permissions.company') },
          { value: 'business', label: `${t(locale, 'permissions.business')} · ${businessName}` },
        ]}
      />
    </div>
  );
}
