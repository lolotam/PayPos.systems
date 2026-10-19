'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isIdentityReadForbidden, isLogoRejection } from '../model/identity-failure';
import { logoContentType } from '../model/logo-file';
import {
  businessIdentityAccessKey,
  mergeBusinessSettings,
  putBusinessLogo,
} from './identity-client';
import { uploadBusinessLogo, type LogoPhase } from './upload-business-logo';

type Scope = { companyId: string; userId: string; businessId: string };

export function useBusinessLogo(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const scope: Scope = { companyId, userId, businessId };
  const [phase, setPhase] = useState<LogoPhase>('idle');
  const [failure, setFailure] = useState<unknown>(null);
  const [writtenId, setWrittenId] = useState<string | null | undefined>(undefined);
  const [removed, setRemoved] = useState(false);
  const upload = useMutation({
    mutationFn: (file: File) => bindReadyLogo(scope, file, setPhase),
    onMutate: () => {
      setFailure(null);
      setRemoved(false);
    },
    onSuccess: (saved) => {
      setPhase('ready');
      setWrittenId(saved.logo_file_id);
      mergeBusinessSettings(client, companyId, userId, businessId, saved);
    },
    onError: (error) => {
      setFailure(error);
      setPhase(isLogoRejection(error) ? 'rejected' : 'idle');
      forgetCapability(client, scope, error);
    },
  });
  const remove = useMutation({
    mutationFn: () => putBusinessLogo(companyId, businessId, null),
    onMutate: () => setFailure(null),
    onSuccess: (saved) => {
      setPhase('idle');
      setRemoved(true);
      setWrittenId(saved.logo_file_id);
      mergeBusinessSettings(client, companyId, userId, businessId, saved);
    },
    onError: (error) => {
      setFailure(error);
      forgetCapability(client, scope, error);
    },
  });
  return { phase, failure, writtenId, removed, upload, remove };
}

function forgetCapability(client: ReturnType<typeof useQueryClient>, scope: Scope, error: unknown) {
  if (!isIdentityReadForbidden(error)) return;
  void client.invalidateQueries({
    queryKey: businessIdentityAccessKey(scope.companyId, scope.userId, scope.businessId),
  });
}

async function bindReadyLogo(scope: Scope, file: File, onPhase: (phase: LogoPhase) => void) {
  const contentType = logoContentType(file);
  if (!contentType) throw new Error('logo file was not checked');
  const id = await uploadBusinessLogo({
    companyId: scope.companyId,
    businessId: scope.businessId,
    contentType,
    file,
    onPhase,
  });
  return putBusinessLogo(scope.companyId, scope.businessId, id);
}
