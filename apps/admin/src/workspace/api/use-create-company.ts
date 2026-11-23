'use client';

import type { CreateCompanyInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  ATTEMPT_STORAGE_NAME,
  isUndecided,
  readAttempt,
  removeAttempt,
  writeAttempt,
  type StoredAttempt,
} from '../model/create-company-attempt';
import { createCompany } from './create-company-client';

/** نداء الإنشاء: إرسال جديد بالقيم المكتوبة، أو إعادة بنفس المفتاح والجسم المخزّنين لمحاولة غير محسومة. */
export type CreateCompanyCall = { kind: 'new'; body: CreateCompanyInput } | { kind: 'retry' };

/**
 * محاولة واحدة غير محسومة في كل لحظة، وحالتها هنا مش مشتقة من رايات الـ mutation: الكتابة قبل
 * ما الطلب يسيب المتصفح بتحدّث الحالة فورًا، والشيل بس بجواب قاطع (201 أو رفض 4xx غير
 * 408/409/429)؛ فشل الشبكة والـ 5xx والتلاتة دول بيبقوها محفوظة عشان «إعادة المحاولة» تبعت
 * نفس المفتاح ونفس الجسم وما تعرفش تعمل شركة تانية. قراءة التخزين بتتعمل كمان عند التركيب
 * وعند تغيّر الهوية وعند حدث storage عشان كتابة تبويب تاني تتشاف.
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
  const mutation = useMutation({
    mutationKey: ['companies', 'create'],
    retry: false,
    gcTime: 0,
    // عند انقطاع الاتصال الطلب بيفشل فورًا كفشل شبكة (والمحاولة تفضل محفوظة) بدل ما يترصّن صامتًا.
    networkMode: 'always',
    mutationFn: async (call: CreateCompanyCall) => {
      if (userId === undefined) throw new TypeError('the signed-in user is not known yet');
      let key: string;
      let body: CreateCompanyInput;
      if (call.kind === 'retry') {
        const held = readAttempt(userId);
        if (held === null) throw new TypeError('no undecided attempt to retry');
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
        removeAttempt();
        setStored(null);
        await client.invalidateQueries({ queryKey: ['me', 'workspaces'] });
        return created;
      } catch (error) {
        if (!isUndecided(error)) {
          removeAttempt();
          setStored(null);
        }
        throw error;
      }
    },
  });
  return { stored, ...mutation };
}
