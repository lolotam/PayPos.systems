import type {
  ServiceCategoryClosingAction,
  ServiceCategoryClosingStatus,
  ServiceCategoryClosingFailureCode,
} from '@pospay/contracts';

export type ServiceCategoryClosingMutationResult =
  | { kind: 'done'; action: ServiceCategoryClosingAction; servicesChanged: number }
  | { kind: 'pending'; action: ServiceCategoryClosingAction; closingId: string };

export type TrackedServiceCategoryClosing = {
  categoryId: string;
  closingId: string;
  action: ServiceCategoryClosingAction;
};

export type ClosingViewInput =
  | ServiceCategoryClosingMutationResult
  | ServiceCategoryClosingStatus
  | { action: ServiceCategoryClosingAction; status: 'pending' };

export type ServiceCategoryClosingView =
  | {
      tone: 'pending';
      key: 'catalogServiceCategories.closing' | 'catalogServiceCategories.reopening';
    }
  | {
      tone: 'done';
      key:
        'catalogServiceCategories.closedWithCount' | 'catalogServiceCategories.reopenedWithCount';
      count: number;
    }
  | { tone: 'failed'; errorCode: ServiceCategoryClosingFailureCode };

const pendingKey = {
  close: 'catalogServiceCategories.closing',
  reopen: 'catalogServiceCategories.reopening',
} as const;
const doneKey = {
  close: 'catalogServiceCategories.closedWithCount',
  reopen: 'catalogServiceCategories.reopenedWithCount',
} as const;

/** تحويل حالة المهمة لنص واحد بيبعد اختلاف شكل رد 200 عن قراءة الحالة عن واجهة الشاشة. */
export function closingView(input: ClosingViewInput): ServiceCategoryClosingView {
  if ('kind' in input && input.kind === 'pending') {
    return { tone: 'pending', key: pendingKey[input.action] };
  }
  if ('kind' in input && input.kind === 'done') {
    return { tone: 'done', key: doneKey[input.action], count: input.servicesChanged };
  }
  if ('status' in input && input.status === 'pending') {
    return { tone: 'pending', key: pendingKey[input.action] };
  }
  if ('status' in input && input.status === 'failed') {
    return {
      tone: 'failed',
      errorCode: input.error_code ?? 'SERVICE_CATEGORY_CLOSING_FAILED',
    };
  }
  return {
    tone: 'done',
    key: doneKey[input.action],
    count: input.services_changed ?? 0,
  };
}

/** العدد بيدخل في النص المترجم من غير ما دالة العرض تعرف اللغة أو تستدعي i18n. */
export function formatCount(text: string, count: number): string {
  return text.replaceAll('{count}', String(count));
}
