'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createServiceCategoryInput,
  type CreateServiceCategoryInput,
  type ServiceCategory,
  type ServiceCategoryDetail,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  useCreateServiceCategory,
  useRenameServiceCategory,
} from '../api/use-service-category-save';
import { ServiceCategoryFormFeedback } from './service-category-form-feedback';
import { ServiceCategoryNameFields } from './service-category-name-fields';

type ServiceCategoryFormProps = {
  companyId: string;
  businessId: string;
  userId: string;
  mode: 'create' | 'rename';
  record?: ServiceCategoryDetail | undefined;
  onSaved: (category: ServiceCategory) => void;
  onReload: () => void;
};

export function ServiceCategoryForm(props: ServiceCategoryFormProps) {
  const locale = useLocale();
  const { mode, record } = props;
  const create = useCreateServiceCategory(props.companyId, props.businessId, props.userId);
  const rename = useRenameServiceCategory(props.companyId, props.businessId, props.userId);
  const form = useForm<CreateServiceCategoryInput>({
    resolver: zodResolver(createServiceCategoryInput),
    defaultValues: { name_en: record?.name_en ?? '', name_ar: record?.name_ar ?? '' },
  });
  const pending = create.isPending || rename.isPending;
  const error = mode === 'create' ? create.error : rename.error;
  const save = (values: CreateServiceCategoryInput) => {
    if (mode === 'create') create.mutate(values, { onSuccess: props.onSaved });
    else if (record) {
      rename.mutate(
        { ...values, categoryId: record.id, expected_revision: record.revision },
        { onSuccess: props.onSaved },
      );
    }
  };
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-3 text-start"
      >
        <h2 className="text-xl font-bold">
          {t(
            locale,
            mode === 'create'
              ? 'catalogServiceCategories.createTitle'
              : 'catalogServiceCategories.editTitle',
          )}
        </h2>
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <ServiceCategoryNameFields mode={mode} />
          <Button type="submit">
            {t(
              locale,
              mode === 'create'
                ? 'catalogServiceCategories.create'
                : 'catalogServiceCategories.save',
            )}
          </Button>
        </fieldset>
        <ServiceCategoryFormFeedback
          mode={mode}
          error={error}
          success={mode === 'create' ? create.isSuccess : rename.isSuccess}
          onReload={props.onReload}
        />
      </form>
    </FormProvider>
  );
}
