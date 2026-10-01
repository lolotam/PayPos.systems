'use client';

import type { WorkspaceBranch, WorkspaceBusiness, WorkspaceCompany } from '@pospay/contracts';
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
      company: WorkspaceCompany;
      business?: WorkspaceBusiness | undefined;
      branch?: WorkspaceBranch | undefined;
    };

export type WorkspaceController = WorkspaceStatus & {
  companies: readonly WorkspaceCompany[];
  choose: (next: SelectionChoice) => void;
};

const WorkspaceContext = createContext<WorkspaceController | null>(null);

function viewOf(
  mounted: boolean,
  pending: boolean,
  isError: boolean,
  error: unknown,
  locale: Locale,
  resolved: ResolvedSelection,
  companies: readonly WorkspaceCompany[],
  choose: (next: SelectionChoice) => void,
): WorkspaceController {
  const shared = { companies, choose };
  if (!mounted || pending) return { ...shared, status: 'loading' };
  if (isError) return { ...shared, status: 'error', message: envelopeMessage(error, locale) };
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
    resolved,
    companies,
    choose,
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceController {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
