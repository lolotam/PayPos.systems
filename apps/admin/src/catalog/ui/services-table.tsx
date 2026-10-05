'use client';
import type { ServiceListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { SERVICE_RULE_LABEL } from '../model/service-rule';

export function ServicesTable({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly ServiceListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <DataTableFrame title={t(locale, 'catalogServices.listTitle')}>
      <table>
        <thead>
          <tr>
            <th scope="col">{t(locale, 'catalogServices.nameEn')}</th>
            <th scope="col">{t(locale, 'catalogServices.price')}</th>
            <th scope="col">{t(locale, 'catalogServices.rule')}</th>
            <th scope="col">{t(locale, 'catalogServices.edit')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={selectedId === item.id ? 'bg-secondary/50' : ''}>
              <td>{locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}</td>
              <td dir="ltr">{item.price}</td>
              <td>{t(locale, SERVICE_RULE_LABEL[item.commission_rule.kind])}</td>
              <td>
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={selectedId === item.id}
                  onClick={() => onSelect(item.id)}
                >
                  {t(locale, 'catalogServices.edit')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
