'use client';

import type { Company, CreateCompanyInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  ATTEMPT_STORAGE_NAME,
  isUndecided,
  markCreated,
  readAttempt,
  removeAttempt,
  writeAttempt,
  type StoredAttempt,
} from '../model/create-company-attempt';
import { createCompany } from './create-company-client';

/** نداء الإنشاء: إرسال جديد بالقيم المكتوبة، أو إعادة بنفس المفتاح والجسم المخزّنين لمحاولة غير محسومة. */
export type CreateCompanyCall = { kind: 'new'; body: CreateCompanyInput } | { kind: 'retry' };

type CreateDeps = {
  userId: string;
  setStored: (stored: StoredAttempt | null) => void;
};

function workspacesCompanies(client: ReturnType<typeof useQueryClient>): readonly unknown[] {
  return client.getQueryData<{ companies?: readonly unknown[] }>(['me', 'workspaces'])?.companies ?? [];
}

/**
 * النجاح ما يشيلش المحاولة: بينشّئ علامة الإنشاء لحد ما قراءة مساحات العمل تشوف الشركة فعليًا
 * — القراءة بيتعمل من الكاش بعد انتظار إعادة الجلب بتاعة الـ invalidation، من غير طلب جديد —
 * عشان إعادة تركيب الصفحة أو تبويب تاني ما يقدرش يبعت مفتاح جديد ويعمل شركة تانية.
 * والرفض القاطع (4xx غير 408/409/429) بس هو اللي بيشرحها؛ فشل الشبكة والـ 5xx بيبقوها.
 */
async function runCreateCall(
  deps: CreateDeps,
  client: ReturnType<typeof useQueryClient>,
  call: CreateCompanyCall,
): Promise<Company> {
  const { userId, setStored } = deps;
  let key: string;
  let body: CreateCompanyInput;
  if (call.kind === 'retry') {
    const held = readAttempt(userId);
    if (held === null) throw new TypeError('no undecided attempt to retry');
    if (held.createdAt !== undefined) throw new TypeError('the stored attempt is already created');
    key = held.key;
    body = held.body;
  } else {
    if (readAttempt(userId) !== null) {
      throw new TypeError('an earlier attempt is still undecided');
    }
    key = crypto.randomUUID();
    body = call.body;
    writeAttempt({ userId, key, body, startedAt: new Date().toISOString() });
    setStored(readAttempt(userId));
  }
  try {
    const created = await createCompany(key, body);
    setStored(markCreated(userId));
    await client.invalidateQueries({ queryKey: ['me', 'workspaces'] });
    if (workspacesCompanies(client).length > 0) {
      removeAttempt();
      setStored(null);
    }
    return created;
  } catch (error) {
    if (!isUndecided(error)) {
      removeAttempt();
      setStored(null);
    }
    throw error;
  }
}

/**
 * محاولة واحدة غير محسومة أو منشأة في كل لحظة، وحالتها هنا مش مشتقة من رايات الـ mutation:
 * كل كتابة أو شيل بيحدّثوا فورًا. قراءة التخزين بتتعمل عند التركيب وعند تغيّر الهوية وعند
 * حدث storage عشان كتابة تبويب تاني تتشاف.
 */
export function useCreateCompany(userId: string | undefined) {
  const client = useQueryClient();
  const [stored, setStored] = useState<StoredAttempt | null>(() => readAttempt(userId));
  const sync = useCallback(() => setStored(readAttempt(userId)), [userId]);
  useEffect(() => {
    sync();
  }, [sync]);
  useEffect(() => {
    if (userId === undefined) return undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === ATTEMPT_STORAGE_NAME || event.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [sync, userId]);
  // عند فك التركيب والكاش شايف شركة (التبديل للوحة الشركة بيحصل في نفس الكومِت اللي بيفك
  // الشاشة) المحاولة المنشأة بتتشال؛ الكون فاضي بيبقوها محفوظة لحد سقف الـ 23 ساعة.
  useEffect(() => {
    return () => {
      if (workspacesCompanies(client).length > 0) removeAttempt();
    };
  }, [client]);
  const mutation = useMutation({
    mutationKey: ['companies', 'create'],
    retry: false,
    gcTime: 0,
    // عند انقطاع الاتصال الطلب بيفشل فورًا كفشل شبكة (والمحاولة تفضل محفوظة) بدل ما يترصّن صامتًا.
    networkMode: 'always',
    mutationFn: (call: CreateCompanyCall) => {
      if (userId === undefined) {
        return Promise.reject(new TypeError('the signed-in user is not known yet'));
      }
      return runCreateCall({ userId, setStored }, client, call);
    },
  });
  return { stored, ...mutation };
}
