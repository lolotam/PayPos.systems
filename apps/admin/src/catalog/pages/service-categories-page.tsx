'use client';
import type { ServiceCategoryClosingStatus, WorkspaceBusiness } from '@pospay/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  useServiceCategoryClosing,
  useServiceCategoryClosingStatus,
  type ServiceCategoryClosingRequest,
} from '../api/use-service-category-closing';
import { useServiceCategoryList, serviceCategoryKey } from '../api/use-service-category-list';
import type {
  ServiceCategoryClosingMutationResult,
  TrackedServiceCategoryClosing,
} from '../model/service-category-closing';
import type { NoticeInput } from '../ui/service-category-closing-notice';
import { ServiceCategoryEditor } from '../ui/service-category-editor';
import { ServiceCategoryPageControls } from '../ui/service-category-page-controls';

type ServiceCategoriesPageProps = {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
};
type CategoryOutcome = { categoryId: string; value: NoticeInput };
type CategoryRefusal = { categoryId: string; error: unknown };
type CategoryClosingState = {
  tracked: TrackedServiceCategoryClosing | null;
  outcome: CategoryOutcome | null;
  refusal: CategoryRefusal | null;
};

function errorClosingId(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('details' in error)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('closing_id' in details)) return null;
  return typeof details.closing_id === 'string' ? details.closing_id : null;
}

/** مجموعة المنتهية والحالة الذرية بتمنع مهمة قديمة من الرجوع بعد اكتمالها أو بعد retry. */
function useClosingState() {
  const [state, setState] = useState<CategoryClosingState>({
    tracked: null,
    outcome: null,
    refusal: null,
  });
  const finished = useRef(new Set<string>());
  const track = (
    categoryId: string,
    closingId: string,
    action: TrackedServiceCategoryClosing['action'],
  ) => {
    if (finished.current.has(closingId)) return;
    setState((current) => ({
      tracked: { categoryId, closingId, action },
      outcome: current.outcome?.categoryId === categoryId ? null : current.outcome,
      refusal: current.refusal?.categoryId === categoryId ? null : current.refusal,
    }));
  };
  const retry = (categoryId: string) => {
    setState((current) => ({
      tracked: current.tracked?.categoryId === categoryId ? null : current.tracked,
      outcome: current.outcome?.categoryId === categoryId ? null : current.outcome,
      refusal: current.refusal?.categoryId === categoryId ? null : current.refusal,
    }));
  };
  return { state, setState, finished, track, retry };
}

/** الطلب مملوك للصفحة، والcallbacks بتستخدم متغيراته عشان الرد المتأخر ما ينسبش لصف آخر. */
function useClosingRequest(
  companyId: string,
  businessId: string,
  userId: string,
  controller: ReturnType<typeof useClosingState>,
) {
  const client = useQueryClient();
  const mutation = useServiceCategoryClosing(companyId, businessId, userId);
  const { setState, track } = controller;
  const succeed = (categoryId: string, result: ServiceCategoryClosingMutationResult) => {
    if (result.kind === 'pending') return track(categoryId, result.closingId, result.action);
    setState((current) => ({
      tracked: current.tracked?.categoryId === categoryId ? null : current.tracked,
      outcome: { categoryId, value: result },
      refusal: current.refusal?.categoryId === categoryId ? null : current.refusal,
    }));
  };
  const fail = (input: ServiceCategoryClosingRequest, error: unknown) => {
    setState((current) => ({ ...current, refusal: { categoryId: input.categoryId, error } }));
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
    if (
      code === 'SERVICE_CATEGORY_COUNT_CHANGED' ||
      code === 'SERVICE_CATEGORY_REVISION_CONFLICT'
    ) {
      const queryKey = [
        ...serviceCategoryKey(companyId, businessId, userId),
        'detail',
        input.categoryId,
      ];
      void client.invalidateQueries({ queryKey });
    } else if (code === 'SERVICE_CATEGORY_CLOSING_IN_PROGRESS') {
      const id = errorClosingId(error);
      if (id) track(input.categoryId, id, input.action);
    } else {
      void client.invalidateQueries({
        queryKey: serviceCategoryKey(companyId, businessId, userId),
      });
    }
  };
  const requestClosing = (input: ServiceCategoryClosingRequest, onAccepted?: () => void) => {
    setState((current) => ({
      ...current,
      refusal: current.refusal?.categoryId === input.categoryId ? null : current.refusal,
    }));
    mutation.mutate(input, {
      onSuccess: (result) => {
        succeed(input.categoryId, result);
        onAccepted?.();
      },
      onError: (error) => fail(input, error),
    });
  };
  return { requestClosing, mutation };
}

/** متابعة الحالة بتقفل المهمة نهائياً وتحتفظ بالنتيجة مع categoryId للعرض عند اختياره فقط. */
function usePageClosing(companyId: string, businessId: string, userId: string) {
  const controller = useClosingState();
  const request = useClosingRequest(companyId, businessId, userId, controller);
  const terminal = (value: ServiceCategoryClosingStatus) => {
    controller.finished.current.add(value.closing_id);
    controller.setState((current) => ({
      tracked: current.tracked?.closingId === value.closing_id ? null : current.tracked,
      outcome: { categoryId: value.category_id, value },
      refusal: current.refusal?.categoryId === value.category_id ? null : current.refusal,
    }));
  };
  const closing = useServiceCategoryClosingStatus(
    companyId,
    businessId,
    userId,
    controller.state.tracked?.categoryId ?? '',
    controller.state.tracked?.closingId ?? '',
    2_000,
    terminal,
  );
  return { ...controller.state, ...request, closing, ...controller };
}

function closingNotice(
  jobs: ReturnType<typeof usePageClosing>,
  selectedId: string,
): NoticeInput | null {
  if (jobs.outcome?.categoryId === selectedId) return jobs.outcome.value;
  if (jobs.tracked?.categoryId !== selectedId) return null;
  return jobs.closing.data ?? { action: jobs.tracked.action, status: 'pending' };
}

export function ServiceCategoriesPage({ companyId, business, userId }: ServiceCategoriesPageProps) {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [cursor, setCursor] = useState<string>();
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const jobs = usePageClosing(companyId, business.id, userId);
  const list = useServiceCategoryList(companyId, business.id, userId, { status, cursor });
  const select = (id: string) => {
    setSelectedId(id);
    setCreating(false);
  };
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <ServiceCategoryPageControls
        status={status}
        onCreate={() => {
          setCreating(true);
          setSelectedId('');
        }}
        onStatus={(next) => {
          setStatus(next);
          setCursor(undefined);
          select('');
        }}
        list={list}
        selectedId={selectedId}
        cursor={cursor}
        tracked={jobs.tracked}
        onSelect={select}
        onPage={(next) => {
          setCursor(next);
          select('');
        }}
      />
      <ServiceCategoryEditor
        companyId={companyId}
        businessId={business.id}
        userId={userId}
        selectedId={selectedId}
        creating={creating}
        tracked={jobs.tracked}
        finished={jobs.finished}
        noticeInput={closingNotice(jobs, selectedId)}
        noticeError={jobs.closing.error}
        closingError={jobs.refusal?.categoryId === selectedId ? jobs.refusal.error : undefined}
        closingPending={jobs.mutation.isPending}
        requestClosing={jobs.requestClosing}
        onTrack={jobs.track}
        onRetry={jobs.retry}
        onSaved={(category) => {
          setCreating(false);
          setStatus('open');
          setCursor(undefined);
          select(category.id);
        }}
        onClose={() => select('')}
      />
    </section>
  );
}
