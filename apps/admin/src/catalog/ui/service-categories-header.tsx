'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { CreateAction } from '../model/use-screen-create-action';

/**
 * ترويسة صفحة التصنيفات الواحدة: العنوان ثابت في كل الحالات، والوصف لعرض النشاط فقط،
 * وزرّ الإضافة يظهر حين يسجّل العرض الظاهر إجراءه (بمظهر العرض: رئيسي للنشاط، مخطّط صغير للفرع).
 */
export function ServiceCategoriesHeader({
  businessView,
  showLead,
  action,
}: {
  businessView: boolean;
  showLead: boolean;
  action: CreateAction | null;
}) {
  const locale = useLocale();
  return (
    <PageHeader
      title={t(locale, 'catalogServiceCategories.listTitle')}
      description={showLead ? t(locale, 'catalogServiceCategories.listLead') : undefined}
      action={
        action ? (
          <Button
            variant={businessView ? 'default' : 'outline'}
            size={businessView ? undefined : 'sm'}
            disabled={action.disabled}
            onClick={action.run}
          >
            {t(locale, 'catalogServiceCategories.create')}
          </Button>
        ) : undefined
      }
    />
  );
}
