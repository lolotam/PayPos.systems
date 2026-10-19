'use client';

import type { BusinessLogo } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { isIdentityReadForbidden, isLogoRejection } from '../model/identity-failure';
import { logoContentType } from '../model/logo-file';
import {
  businessIdentityAccessKey,
  putBusinessLogo,
  refreshBusinessIdentity,
} from './identity-client';
import {
  cancelledLogoUpload,
  isCancelledUpload,
  uploadBusinessLogo,
  type LogoPhase,
} from './upload-business-logo';

type Scope = { companyId: string; userId: string; businessId: string };
type Client = ReturnType<typeof useQueryClient>;

function logoScope(businessId: string) {
  return { id: `business-logo:${businessId}` };
}

function forgetCapability(client: Client, scope: Scope, error: unknown) {
  if (!isIdentityReadForbidden(error)) return;
  void client.invalidateQueries({
    queryKey: businessIdentityAccessKey(scope.companyId, scope.userId, scope.businessId),
  });
}

async function bindReadyLogo(
  scope: Scope,
  file: File,
  onPhase: (phase: LogoPhase) => void,
  signal: AbortSignal | undefined,
) {
  const contentType = logoContentType(file);
  if (!contentType) throw new Error('logo file was not checked');
  const id = await uploadBusinessLogo({
    companyId: scope.companyId,
    businessId: scope.businessId,
    contentType,
    file,
    onPhase,
    ...(signal ? { signal } : {}),
  });
  if (signal?.aborted) throw cancelledLogoUpload();
  return putBusinessLogo(scope.companyId, scope.businessId, id);
}

async function publishLogo(client: Client, scope: Scope, saved: BusinessLogo, apply: () => void) {
  await refreshBusinessIdentity(client, scope.companyId, scope.userId, scope.businessId, saved);
  apply();
}

function useLogoLifetime() {
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);
  return { mounted, signal: () => abortRef.current?.signal };
}

export function useBusinessLogo(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const { mounted, signal } = useLogoLifetime();
  const [phase, setPhase] = useState<LogoPhase>('idle');
  const [failure, setFailure] = useState<unknown>(null);
  const [removeFailure, setRemoveFailure] = useState<unknown>(null);
  const [removed, setRemoved] = useState(false);
  const scope: Scope = { companyId, userId, businessId };
  const report = (next: LogoPhase) => {
    if (mounted.current) setPhase(next);
  };
  const upload = useMutation({
    scope: logoScope(businessId),
    mutationFn: (file: File) => bindReadyLogo(scope, file, report, signal()),
    onMutate: () => {
      if (!mounted.current) return;
      setFailure(null);
      setRemoveFailure(null);
      setRemoved(false);
    },
    onSuccess: (saved) =>
      publishLogo(client, scope, saved, () => {
        if (!mounted.current) return;
        setPhase('ready');
        setRemoved(false);
      }),
    onError: (error) => {
      if (!mounted.current || isCancelledUpload(error)) return;
      setFailure(error);
      setPhase(isLogoRejection(error) ? 'rejected' : 'idle');
      forgetCapability(client, scope, error);
    },
  });
  const remove = useMutation({
    scope: logoScope(businessId),
    mutationFn: () => putBusinessLogo(companyId, businessId, null),
    onMutate: () => {
      if (mounted.current) setRemoveFailure(null);
    },
    onSuccess: (saved) =>
      publishLogo(client, scope, saved, () => {
        if (!mounted.current) return;
        setPhase('idle');
        setRemoved(saved.logo_file_id === null);
      }),
    onError: (error) => {
      if (!mounted.current) return;
      setRemoveFailure(error);
      forgetCapability(client, scope, error);
    },
  });
  return { phase, failure, removeFailure, removed, upload, remove };
}
