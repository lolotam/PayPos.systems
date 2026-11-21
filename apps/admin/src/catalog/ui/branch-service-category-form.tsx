'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBranchServiceCategoryInput,
  type CreateBranchServiceCategoryInput,
  type ServiceCategory,
  type ServiceCategoryBranchListItem,
} from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  useBranchServiceCategoryCreate,
  useBranchServiceCategoryRename,
} from '../api/use-branch-service-category-save';
import { ServiceCategoryFormFeedback } from './service-category-form-feedback';
import { ServiceCategoryNameFields } from './service-category-name-fields';
import { ServiceCategoryVisibilityField } from './service-category-visibility-field';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

type BranchCategoryFormScope = {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
};

/** حفظ النموذج: الإنشاء بيضيف من الفرع، وإعادة التسمية بتبعت الاسمين ونسخة البند بس. */
function useBranchCategoryFormState({
  scope,
  mode,
  record,
  onCreated,
  onRenamed,
}: {
  scope: BranchCategoryFormScope;
  mode: 'create' | 'rename';
  record?: ServiceCategoryBranchListItem | undefined;
  onCreated?: ((category: ServiceCategory) => void) | undefined;
  onRenamed?: (() => void) | undefined;
}) {
  const create = useBranchServiceCategoryCreate(
    scope.companyId,
    scope.businessId,
    scope.userId,
    scope.branchId,
  );
  const rename = useBranchServiceCategoryRename(
    scope.companyId,
    scope.businessId,
    scope.userId,
    scope.branchId,
  );
  const save = (values: CreateBranchServiceCategoryInput) => {
    if (mode === 'create')
      create.mutate(values, { onSuccess: (category) => onCreated?.(category) });
    else if (record)
      rename.mutate(
        {
          categoryId: record.id,
          name_en: values.name_en,
          name_ar: values.name_ar,
          expected_revision: record.revision,
        },
        { onSuccess: () => onRenamed?.() },
      );
  };
  return {
    save,
    pending: create.isPending || rename.isPending,
    error: mode === 'create' ? create.error : rename.error,
    titleKey: (mode === 'create'
      ? 'catalogServiceCategories.createTitle'
      : 'catalogServiceCategories.editTitle') as MessageKey,
    submitKey: (mode === 'create'
      ? 'catalogServiceCategories.create'
      : 'catalogServiceCategories.save') as MessageKey,
  };
}

type BranchServiceCategoryFormProps = BranchCategoryFormScope & {
  mode: 'create' | 'rename';
  record?: ServiceCategoryBranchListItem | undefined;
  onCreated?: ((category: ServiceCategory) => void) | undefined;
  onRenamed?: (() => void) | undefined;
  onReload: () => void;
  onSeeAvailable?: (() => void) | undefined;
};

/**
 * نموذج الإنشاء وإعادة التسمية للفرع. الإنشاء بيسأل «مين يستخدم التصنيف» من غير
 * اختيار مبدئي، وإعادة التسمية بتبعت الاسمين وexpected_revision بس من غير مفتاح
 * visibility — القيمة المتبذّرة في النموذج بتاعة التصنيف نفسه ولا تُرسل. النموذج
 * بيتفعل بمفتاح id:revision فوقه، فإعادة التحميل بعد تعارض النسخة بتبذّره
 * بالأسماء والنسخة الجداد من غير إدخال يدوي.
 */
export function BranchServiceCategoryForm({
  companyId,
  businessId,
  userId,
  branchId,
  mode,
  record,
  onCreated,
  onRenamed,
  onReload,
  onSeeAvailable,
}: BranchServiceCategoryFormProps) {
  const locale = useLocale();
  const { save, pending, error, titleKey, submitKey } = useBranchCategoryFormState({
    scope: { companyId, businessId, userId, branchId },
    mode,
    record,
    onCreated,
    onRenamed,
  });
  const form = useForm<CreateBranchServiceCategoryInput>({
    resolver: zodResolver(createBranchServiceCategoryInput),
    defaultValues: {
      name_en: record?.name_en ?? '',
      name_ar: record?.name_ar ?? '',
      ...(record ? { visibility: record.visibility } : {}),
    },
  });
  return (
    <FormProvider {...form}>
      <form
        noValidate
        aria-label={t(locale, titleKey)}
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-3 text-start"
      >
        <h2 className="text-xl font-bold">{t(locale, titleKey)}</h2>
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <ServiceCategoryNameFields mode={mode} />
          {mode === 'create' ? <ServiceCategoryVisibilityField /> : null}
          <Button type="submit">{t(locale, submitKey)}</Button>
        </fieldset>
        <ServiceCategoryFormFeedback
          mode={mode}
          error={error}
          success={false}
          onReload={onReload}
        />
        {hasCode(error, 'SERVICE_CATEGORY_NAME_TAKEN') && onSeeAvailable ? (
          <Button type="button" variant="outline" onClick={onSeeAvailable}>
            {t(locale, 'catalogServiceCategoryBranches.seeAvailable')}
          </Button>
        ) : null}
      </form>
    </FormProvider>
  );
}
