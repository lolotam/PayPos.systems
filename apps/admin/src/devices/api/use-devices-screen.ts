'use client';

import {
  pairingCode,
  pendingDevicesResponse,
  type PendingDevicesResponse,
} from '@pospay/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { apiClient } from '@/shared/api/client';

import { remainingSecondsUntil } from '../model/devices-countdown';

// شاشة الأجهزة (spec 071): كود ربط للفرع، قائمة الأجهزة المستنية وقائمة الأجهزة الفعالة.
// القراءات بتتم keyed بالشركة والنشاط والفرع والمستخدم، فالتبديل بين الفروع ما بيعرضش بيانات فرع تاني.
export type DevicesScope = {
  companyId: string;
  businessId: string;
  branchId: string;
  userId: string;
};

export type IssuedPairingCode = {
  code: string;
  expiresAt: string;
  issuedAt: string;
};

const PAGE_LIMIT = 20;
const POLL_INTERVAL_MS = 5_000;

export function useDevicesScreen(scope: DevicesScope) {
  const { companyId, businessId, branchId, userId } = scope;
  const client = useQueryClient();
  // المفتاح لازم يفضل ثابت بين الرندرات، وإلا كل رندر كان هيمسح القراءات ويعيدها من الأول.
  const key = useMemo(
    () => ['devices', companyId, businessId, branchId, userId],
    [companyId, businessId, branchId, userId],
  );
  const [issued, setIssued] = useState<IssuedPairingCode | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // العدّاد بيلف كل ثانية طول ما فيه كود حي، عشان الوقت المتبقي يبقى صحيح قدام المستخدم.
  useEffect(() => {
    if (issued === null) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [issued]);

  const issue = useMutation({
    mutationFn: async () => {
      const result = await apiClient().POST('/v1/branches/{branchId}/devices/pairing-code', {
        params: { header: { 'x-company-id': companyId }, path: { branchId } },
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return pairingCode.parse(result.data);
    },
    onSuccess: (result) => {
      setIssued({
        code: result.code,
        expiresAt: result.expires_at,
        issuedAt: new Date().toISOString(),
      });
      setNowMs(Date.now());
    },
  });

  const remaining = issued === null ? 0 : remainingSecondsUntil(issued.expiresAt, nowMs);
  const live = issued !== null && remaining > 0;

  const pending = useBranchDevices(scope, key, 'pending', live ? POLL_INTERVAL_MS : false);
  const active = useBranchDevices(scope, key, 'active', false);

  const invalidate = (status?: 'pending' | 'active') => {
    void client.invalidateQueries({ queryKey: status === undefined ? key : [...key, status] });
  };

  // الرفض (من المستنية) والشيل (من الفعالة) إجراءان منفصلان، فخطأ واحد فيهم ما بيظهرش في القسم التاني.
  // البدء في أي إجراء بيمسح خطأ الإجراء التاني في نفس القسم، عشان الشاشة ما تعرضش خطأ قديم.
  const approve = useDeviceAction(scope, 'approve', {
    onMutate: () => refusePending.reset(),
    onDone: () => invalidate(),
  });
  const refusePending = useDeviceAction(scope, 'revoke', {
    onMutate: () => approve.reset(),
    onDone: () => invalidate('pending'),
  });
  const removeActive = useDeviceAction(scope, 'revoke', {
    onDone: () => invalidate('active'),
  });

  // البيانات المحفوظة للفرع القديم بتتشال مع تبديل الفرع، عشان ما تظهرش في الشاشة الجديدة.
  useEffect(
    () => () => {
      client.removeQueries({ queryKey: key });
    },
    [client, key],
  );

  return { issued, remaining, live, issue, pending, active, approve, refusePending, removeActive };
}

function useBranchDevices(
  scope: DevicesScope,
  key: readonly string[],
  status: 'pending' | 'active',
  refetchInterval: number | false,
) {
  const { companyId, branchId } = scope;
  return useInfiniteQuery({
    queryKey: [...key, status],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: PendingDevicesResponse) => page.next_cursor ?? undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await apiClient().GET('/v1/branches/{branchId}/devices', {
        params: {
          header: { 'x-company-id': companyId },
          path: { branchId },
          query: {
            status,
            limit: PAGE_LIMIT,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return pendingDevicesResponse.parse(result.data);
    },
    retry: false,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

function useDeviceAction(
  scope: DevicesScope,
  action: 'approve' | 'revoke',
  hooks: { onMutate?: () => void; onDone: () => void },
) {
  const { companyId, branchId } = scope;
  return useMutation({
    mutationFn: async (deviceId: string) => {
      const path =
        action === 'approve'
          ? ('/v1/branches/{branchId}/devices/{deviceId}/approve' as const)
          : ('/v1/branches/{branchId}/devices/{deviceId}/revoke' as const);
      const result = await apiClient().POST(path, {
        params: { header: { 'x-company-id': companyId }, path: { branchId, deviceId } },
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return result.response.status;
    },
    ...(hooks.onMutate === undefined ? {} : { onMutate: hooks.onMutate }),
    onSuccess: hooks.onDone,
  });
}
