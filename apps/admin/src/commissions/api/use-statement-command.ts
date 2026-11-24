'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { statementKey, type StatementScope } from './commission-statement-client';
import { executeStatementCommand, staleRefusal, type StatementRequest } from './statement-commands';
import { statementQueryOptions } from './use-commission-statement';
import type { StatementReading } from '../model/statement-reading';
import { statementVersion } from '../model/statement-version';

/**
 * رد السيرفر بيثبت إن الكتابة ما حصلتش: غلاف خطأ حقيقي بكوده، حتى لو حالته 503 (زي NOT_READY: السيرفر رفض قبل
 * ما الكتابة تشتغل)، إلا «لسه بيتعالج». رد من غير غلاف (انقطاع، مهلة، 502 أو 503 أو 504 من بوابة) ممكن يكون
 * اتسجّل على السيرفر، فمفتاحه بيفضل للمحاولة اللي بعدها.
 */
function provesNotWritten(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== 'IDEMPOTENCY_KEY_IN_PROGRESS';
}

/**
 * ينفّذ أمر كتابة على كشف شهر. قبل الإرسال بيقرا الكشف قراءة طازجة، ولو نسخته غير اللي المستخدم شافها
 * لحظة فتح الحوار ما بيبعتش حاجة ويرفض كأن البصمة قديمة. مفتاح المحاولة بيعيش مع فتحة الحوار والجسم بس،
 * ومحاولة ضاع ردها بتتعاد بنفس المفتاح جوّه نفس الفتحة. بعد النجاح الكشف المحفوظ بيتحدّث من رد الكتابة
 * فورًا ثم بيتقرا من جديد؛ والأمر بيشتغل حتى والشبكة واقعة فيفشل في الحال برسالة الشبكة بدل ما يستنى.
 */
export function useStatementCommand(scope: StatementScope, period: string) {
  const client = useQueryClient();
  const attempts = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationKey: ['commission-statement-command', ...scope, period],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: async ({ command, openingId, seenVersion }: StatementRequest) => {
      const fresh = await client.fetchQuery(statementQueryOptions(scope, period));
      if (statementVersion(fresh) !== seenVersion) throw staleRefusal();
      const identity = `${openingId}:${command.kind}:${JSON.stringify('body' in command ? command.body : null)}`;
      const key = attempts.current.get(identity) ?? crypto.randomUUID();
      attempts.current.set(identity, key);
      let next;
      try {
        next = await executeStatementCommand({ scope, period }, key, command, fresh);
      } catch (error) {
        if (provesNotWritten(error)) attempts.current.delete(identity);
        throw error;
      }
      attempts.current.delete(identity);
      // رد الكتابة بيحل محل الكشف المحفوظ بس لو هو لسه النسخة اللي الحوار اتفتح عليها: لو قراءة أحدث (نطاقها ممكن
      // يكون ضاق) وصلت في الأثناء، بنسيبها ونكتفي بإعادة القراءة.
      const cachedNow = client.getQueryData<StatementReading>(statementKey(scope, period));
      if (next !== undefined && cachedNow !== undefined && statementVersion(cachedNow) === seenVersion) {
        client.setQueryData(statementKey(scope, period), next);
      }
      await client.invalidateQueries({ queryKey: statementKey(scope, period) });
      return next;
    },
  });
  return {
    mutate: mutation.mutate,
    reset: mutation.reset,
    isPending: mutation.isPending,
    error: mutation.error,
    /** بيمسح مفاتيح المحاولات اللي لسه نتيجتها مجهولة لما فتحة الحوار تتقفل. */
    forget(openingId: string) {
      for (const identity of attempts.current.keys()) {
        if (identity.startsWith(`${openingId}:`)) attempts.current.delete(identity);
      }
    },
  };
}
