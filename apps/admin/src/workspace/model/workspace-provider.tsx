'use client';

import type { WorkspaceBranch, WorkspaceBusinessRead, WorkspaceCompanyRead } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import {
  readSelection,
  selectionMatches,
  writeSelection,
  type SelectionChoice,
} from '@/shared/api/selection-cookie';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';

import { useWorkspaces } from '../api/use-workspaces';
import { resolveSelection, type ResolvedSelection } from './resolve-selection';

type WorkspaceStatus =
  | { status: 'loading' | 'empty' | 'choose' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      company: WorkspaceCompanyRead;
      business?: WorkspaceBusinessRead | undefined;
      branch?: WorkspaceBranch | undefined;
    };

export type WorkspaceController = WorkspaceStatus & {
  companies: readonly WorkspaceCompanyRead[];
  /**
   * هل قدرة دخول الموظفات (spec 076) مفتوحة على السيرفر؟ الأدمن بيقراها من قراءة مساحات العمل
   * بدل ما يخمّن ويطلب مسار مقفول يرد 503. اختياري: أي مزوّد ما بيعرفش القدرة تُقرأ مقفولة.
   */
  staffAccess?: boolean;
  choose: (next: SelectionChoice) => void;
};

const WorkspaceContext = createContext<WorkspaceController | null>(null);

// رفض الوصول على قراءة مساحات العمل معناه الجلسة خلصت أو الوصول اتشال — بيظهر كخطأ دايمًا
// حتى بعد قراءة ناجحة، زي ما باقي عملاء Admin بيقراو status الرفض؛ باقي الفشل مش وصول.
function isAccessRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function viewOf(
  mounted: boolean,
  pending: boolean,
  isError: boolean,
  error: unknown,
  locale: Locale,
  hasRead: boolean,
  resolved: ResolvedSelection,
  companies: readonly WorkspaceCompanyRead[],
  staffAccess: boolean,
  choose: (next: SelectionChoice) => void,
): WorkspaceController {
  const shared = { companies, staffAccess, choose };
  if (!mounted || pending) return { ...shared, status: 'loading' };
  // `hasRead` = قراءة ناجحة حصلت قبل كده (الـ data موجودة حتى لو ليستة فاضية)، وفشل إعادة
  // جلب بعدها ما يهدمش الصفحة: كل صفحات اللوحة بتفضل على المحتوى المختار من البيانات القديمة،
  // وشاشة إنشاء الشركة (077) بتكمل بإعادة التحميل بتاعتها. الاستثناء هو رفض الوصول (401/403)
  // على القراءة نفسها: الجلسة خلصت أو الوصول اتشال، فده لازم يظهر كخطأ زي أول قراءة فاشلة.
  if (isError && (!hasRead || isAccessRefusal(error))) {
    return { ...shared, status: 'error', message: envelopeMessage(error, locale) };
  }
  if (resolved.status === 'empty') return { ...shared, status: 'empty' };
  if (resolved.status === 'choose' || !resolved.company) return { ...shared, status: 'choose' };
  return {
    ...shared,
    status: 'ready',
    company: resolved.company,
    business: resolved.business,
    branch: resolved.branch,
  };
}

function rememberResolved(mounted: boolean, ready: boolean, next: SelectionChoice): void {
  if (!mounted || !ready) return;
  if (!selectionMatches(readSelection(), next)) writeSelection(next);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const mounted = useMounted();
  const [choice, setChoice] = useState<SelectionChoice | null>(null);
  const query = useWorkspaces(mounted);
  const companies = query.data?.companies ?? [];
  const resolved = resolveSelection(companies, choice ?? (mounted ? readSelection() : {}));
  const companyId = resolved.company?.id;
  const businessId = resolved.business?.id;
  const branchId = resolved.branch?.id;
  useEffect(() => {
    rememberResolved(mounted, query.isSuccess, { companyId, businessId, branchId });
  }, [branchId, businessId, companyId, mounted, query.isSuccess]);
  const choose = (next: SelectionChoice) => setChoice(next);
  const value = viewOf(
    mounted,
    query.isPending,
    query.isError,
    query.error,
    locale,
    query.data !== undefined,
    resolved,
    companies,
    query.data?.capabilities.staff_access === true,
    choose,
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceController {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
