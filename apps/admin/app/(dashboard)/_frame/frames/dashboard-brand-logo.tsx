'use client';

import type { MyWorkspacesReadResponse } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { BrandLockup, BrandMark, cn } from '@pospay/ui';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext, useMemo, useState, useSyncExternalStore } from 'react';

import { issueLogoDownload } from '@/business-identity/api/identity-client';
import { useLocale } from '@/shared/locale/locale-context';
import { workspacesQueryKey } from '@/workspace/api/use-workspaces';
import { displayName } from '@/workspace/model/display-name';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export type DashboardBrandLogoVariant = 'lockup' | 'mark';

export interface DashboardBrandLogoProps {
  readonly variant?: DashboardBrandLogoVariant;
  readonly tone?: 'ink' | 'sidebar';
  readonly className?: string;
}

/**
 * بيشوف معرّف الشعار في كاش مساحات العمل، أو undefined لما النشاط مش موجود في الكاش أصلاً.
 * الـ undefined بيفرق عن null: null معناها الكاش عارف إن النشاط مالوش شعار، وundefined معناها الكاش فاضي.
 */
function cachedLogoFileId(
  client: QueryClient | undefined,
  companyId: string | undefined,
  businessId: string | undefined,
): string | null | undefined {
  if (!client || !companyId || !businessId) return undefined;
  const data = client.getQueryData<MyWorkspacesReadResponse>(workspacesQueryKey);
  if (!data) return undefined;
  for (const company of data.companies) {
    if (company.id !== companyId) continue;
    for (const business of company.businesses) {
      if (business.id === businessId) return business.logo_file_id ?? null;
    }
  }
  return undefined;
}

/**
 * بيقرأ معرّف الشعار من كاش مساحات العمل، ويشترك في الكاش عشان الرفع والاستبدال يغيّروا الرأس على طول.
 * من غير مزوّد كاش (اختبارات الإطار) الاشتراك بيتخطّى واللون بييجي من مساحة العمل بس.
 */
function useCachedLogoFileId(
  client: QueryClient | undefined,
  companyId: string | undefined,
  businessId: string | undefined,
): string | null | undefined {
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      if (!client) return () => undefined;
      return client.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (key[0] === workspacesQueryKey[0] && key[1] === workspacesQueryKey[1]) onChange();
      });
    },
    [client],
  );
  return useSyncExternalStore(
    subscribe,
    () => cachedLogoFileId(client, companyId, businessId),
    () => undefined,
  );
}

/** كاش احتياطي فقط لاختبارات الإطار اللي بتركّب من غير QueryClientProvider؛ التطبيق نفسه بيمرّر كاش الجلسة. */
const fallbackQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/**
 * بيطلب رابط تنزيل موقّع للشعار المربوط عن طريق TanStack Query، عشان المكونات المتزامنة في
 * Style A تتشارك نفس الطلب وما تضاعفش صفوف الـ audit. غياب الشعار أو فشل الطلب بيسيب PosPay.
 */
function useLogoUrl(
  client: QueryClient | undefined,
  companyId: string | undefined,
  logoFileId: string | null,
): { url: string | null; broken: boolean; markBroken: () => void } {
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const current = companyId !== undefined && logoFileId !== null ? `${companyId}:${logoFileId}` : null;
  const { data: url = null, isError } = useQuery(
    {
      queryKey: ['logo-download', companyId ?? null, logoFileId] as const,
      queryFn: async ({ signal }) => {
        if (companyId === undefined || logoFileId === null) {
          throw new Error('logo download parameters missing');
        }
        const download = await issueLogoDownload(companyId, logoFileId, signal);
        return download.download_url;
      },
      enabled: current !== null,
      staleTime: client ? 45_000 : 0,
      gcTime: client ? 55_000 : 0,
      retry: false,
    },
    client ?? fallbackQueryClient,
  );
  return {
    url,
    broken: isError || (current !== null && brokenKey === current),
    markBroken: () => setBrokenKey(current),
  };
}

/**
 * شعار النشاط النشط في رأس اللوحة: شعار النشاط نفسه لما موجود، وشعار PosPay لما لأ.
 * القراءة من الكاش بتخلي رفع أو استبدال الشعار يغيّر الرأس على طول من غير إعادة تحميل.
 */
export function DashboardBrandLogo({
  variant = 'lockup',
  tone = 'ink',
  className,
}: DashboardBrandLogoProps) {
  const locale = useLocale();
  const workspace = useWorkspace();
  const client = useContext(QueryClientContext);
  const business = workspace.status === 'ready' ? workspace.business : undefined;
  const companyId = workspace.status === 'ready' ? workspace.company.id : undefined;
  const cached = useCachedLogoFileId(client, companyId, business?.id);
  const logoFileId = cached === undefined ? (business?.logo_file_id ?? null) : cached;
  const { url, broken, markBroken } = useLogoUrl(client, companyId, logoFileId);
  if (url !== null && !broken && business)
    return (
      <img
        src={url}
        alt={displayName(business, locale)}
        className={cn('h-9 w-auto max-w-[9rem] shrink-0 object-contain', className)}
        onError={markBroken}
      />
    );
  if (variant === 'lockup')
    return (
      <BrandLockup
        tone={tone}
        title={t(locale, 'brand.title')}
        latinName={t(locale, 'brand.latinName')}
        arabicName={t(locale, 'brand.arabicName')}
        className={cn('max-h-10 max-w-full', className)}
      />
    );
  return <BrandMark title={t(locale, 'brand.title')} className={cn('size-9', className)} />;
}
