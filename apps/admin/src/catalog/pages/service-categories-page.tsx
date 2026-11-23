'use client';
import type { ServiceCategoryClosingStatus, WorkspaceBusinessRead } from '@pospay/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  useServiceCategoryClosing,
  useServiceCategoryClosingStatuses,
  type ServiceCategoryClosingRequest,
} from '../api/use-service-category-closing';
import { useServiceCategoryList, serviceCategoryKey } from '../api/use-service-category-list';
import type {
  ServiceCategoryClosingMutationResult,
  TrackedServiceCategoryClosing,
} from '../model/service-category-closing';
import type { CreateEmbed } from '../model/use-register-create-action';
import type { NoticeInput } from '../ui/service-category-closing-notice';
import { ServiceCategoryEditor } from '../ui/service-category-editor';
import { ServiceCategoryPageControls } from '../ui/service-category-page-controls';

type ServiceCategoriesPageProps = {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
  /** حين تضمّ الشاشة الصفحة تملك هي الترويسة وزرّ الإضافة، فتسجّل الصفحة إجراءها بدل رسم ترويستها. */
  embed?: CreateEmbed;
};
type CategoryClosingState = {
  tracked: Readonly<Record<string, TrackedServiceCategoryClosing>>;
  outcome: Readonly<Record<string, NoticeInput>>;
  refusal: Readonly<Record<string, unknown>>;
};

function withoutCategory<T>(values: Readonly<Record<string, T>>, categoryId: string) {
  return Object.fromEntries(
    Object.entries(values).filter(([id]) => id !== categoryId),
  ) as Record<string, T>;
}

function errorClosingId(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('details' in error)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('closing_id' in details)) return null;
  return typeof details.closing_id === 'string' ? details.closing_id : null;
}

/** مجموعة المنتهية والحالة الذرية بتمنع مهمة قديمة من الرجوع بعد اكتمالها أو بعد retry. */
function useClosingState() {
  const [state, setState] = useState<CategoryClosingState>({
    tracked: {},
    outcome: {},
    refusal: {},
  });
  const finished = useRef(new Set<string>());
  const track = (
    categoryId: string,
    closingId: string,
    action: TrackedServiceCategoryClosing['action'],
  ) => {
    if (finished.current.has(closingId)) return;
    setState((current) => ({
      tracked: { ...current.tracked, [categoryId]: { categoryId, closingId, action } },
      outcome: withoutCategory(current.outcome, categoryId),
      refusal: withoutCategory(current.refusal, categoryId),
    }));
  };
  const retry = (categoryId: string) => {
    setState((current) => ({
      tracked: withoutCategory(current.tracked, categoryId),
      outcome: withoutCategory(current.outcome, categoryId),
      refusal: withoutCategory(current.refusal, categoryId),
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
      tracked: withoutCategory(current.tracked, categoryId),
      outcome: { ...current.outcome, [categoryId]: result },
      refusal: withoutCategory(current.refusal, categoryId),
    }));
  };
  const fail = (input: ServiceCategoryClosingRequest, error: unknown) => {
    setState((current) => ({
      ...current,
      refusal: { ...current.refusal, [input.categoryId]: error },
    }));
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
      refusal: withoutCategory(current.refusal, input.categoryId),
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
  const terminal = (terminalStatus: ServiceCategoryClosingStatus) => {
    controller.finished.current.add(terminalStatus.closing_id);
    controller.setState((current) => ({
      tracked:
        current.tracked[terminalStatus.category_id]?.closingId === terminalStatus.closing_id
          ? withoutCategory(current.tracked, terminalStatus.category_id)
          : current.tracked,
      outcome: { ...current.outcome, [terminalStatus.category_id]: terminalStatus },
      refusal: withoutCategory(current.refusal, terminalStatus.category_id),
    }));
  };
  const trackedJobs = Object.values(controller.state.tracked);
  const closing = useServiceCategoryClosingStatuses({
    companyId,
    businessId,
    userId,
    jobs: trackedJobs,
    pollMs: 2_000,
    onTerminal: terminal,
  });
  const closingFor = (categoryId: string) => {
    const index = trackedJobs.findIndex((job) => job.categoryId === categoryId);
    return index === -1 ? undefined : closing[index];
  };
  return { ...controller.state, ...request, closingFor, ...controller };
}

function closingNotice(
  jobs: ReturnType<typeof usePageClosing>,
  selectedId: string,
): NoticeInput | null {
  const outcome = jobs.outcome[selectedId];
  if (outcome) return outcome;
  const tracked = jobs.tracked[selectedId];
  if (!tracked) return null;
  return jobs.closingFor(selectedId)?.data ?? { action: tracked.action, status: 'pending' };
}

export function ServiceCategoriesPage(props: ServiceCategoriesPageProps) {
  const { companyId, business, userId, embed } = props;
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [cursor, setCursor] = useState<string>();
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const startCreate = () => { setCreating(true); setSelectedId(''); };
  const jobs = usePageClosing(companyId, business.id, userId);
  const list = useServiceCategoryList(companyId, business.id, userId, { status, cursor });
  const select = (id: string) => {
    setSelectedId(id);
    setCreating(false);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4 text-start md:gap-6">
      <ServiceCategoryPageControls
        status={status}
        embed={embed}
        onCreate={startCreate}
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
        tracked={jobs.tracked[selectedId] ?? null}
        finished={jobs.finished}
        noticeInput={closingNotice(jobs, selectedId)}
        noticeError={jobs.closingFor(selectedId)?.error}
        closingError={jobs.refusal[selectedId]}
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
    </div>
  );
}
