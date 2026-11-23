'use client';

import type { CreateCompanyInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  isUndecided,
  readAttempt,
  removeAttempt,
  writeAttempt,
} from '../model/create-company-attempt';
import { createCompany } from './create-company-client';

/** نداء الإنشاء: إرسال جديد بالقيم المكتوبة، أو إعادة بنفس المفتاح والجسم المخزّنين لمحاولة غير محسومة. */
export type CreateCompanyCall = { kind: 'new'; body: CreateCompanyInput } | { kind: 'retry' };

/**
 * محاولة واحدة غير محسومة في كل لحظة: بتتكتب في التخزين قبل ما الطلب يسيب المتصفح، وما بتتشالش
 * غير بجواب قاطع (201 أو رفض 4xx غير 408/409/429)؛ فشل الشبكة والـ 5xx والتلاتة دول بيبقوا
 * المحاولة محفوظة عشان «إعادة المحاولة» تبعت نفس المفتاح ونفس الجسم وما تعرفش تعمل شركة تانية.
 */
export function useCreateCompany(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
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
        const stored = readAttempt(userId);
        if (stored === null) throw new TypeError('no undecided attempt to retry');
        key = stored.key;
        body = stored.body;
      } else {
        if (readAttempt(userId) !== null) {
          throw new TypeError('an earlier attempt is still undecided');
        }
        key = crypto.randomUUID();
        body = call.body;
        writeAttempt({ userId, key, body, startedAt: new Date().toISOString() });
      }
      try {
        const created = await createCompany(key, body);
        removeAttempt();
        await client.invalidateQueries({ queryKey: ['me', 'workspaces'] });
        return created;
      } catch (error) {
        if (!isUndecided(error)) removeAttempt();
        throw error;
      }
    },
  });
}
