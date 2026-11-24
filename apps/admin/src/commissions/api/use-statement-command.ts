'use client';

import type { CommissionStatementReturnInput, CommissionStatementReviewInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type RefObject } from 'react';
import {
  generateStatement,
  returnStatement,
  reviewStatement,
  statementKey,
  type StatementScope,
} from './commission-statement-client';

/** أمر كتابة على الكشف مع جسمه: كل أمر بمفتاح محاولته. */
export type StatementCommand =
  | { kind: 'generate' }
  | { kind: 'review'; body: CommissionStatementReviewInput }
  | { kind: 'return'; body: CommissionStatementReturnInput };

/** ذاكرة مفاتيح المحاولات اللي نتيجتها مجهولة، بتعيش مع الصفحة. */
export type StatementAttemptMemory = RefObject<Map<string, string>>;

/** ذاكرة محاولات الكتابة اللي بتعيش مع الصفحة: بتتصفّر بتغيّر الهوية لأن المسار بيعمل remount. */
export function useStatementAttemptMemory(): StatementAttemptMemory {
  const [attempts] = useState(() => ({ current: new Map<string, string>() }));
  return attempts;
}

function hasResponse(error: unknown): boolean {
  return typeof (error as { status?: unknown } | null)?.status === 'number';
}

async function run(
  scope: StatementScope,
  period: string,
  key: string,
  command: StatementCommand,
): Promise<unknown> {
  if (command.kind === 'generate') return generateStatement(scope, period, key);
  if (command.kind === 'review') return reviewStatement(scope, period, key, command.body);
  return returnStatement(scope, period, key, command.body);
}

/**
 * ينفّذ أمر كتابة على كشف شهر: نفس الأمر بنفس الجسم لنفس الشهر بيستعمل مفتاح المحاولة المحفوظ لحد ما
 * نتيجة معروفة تيجي (رد مفقود ممكن يكون اتسجّل على السيرفر)، والجسم المختلف بياخد مفتاح جديد. أي رد
 * حقيقي من السيرفر بيحسم المحاولة ويمسح مفتاحها، إلا «لسه بيتعالج». بعد النجاح العرض بيتقرا من جديد.
 */
export function useStatementCommand(scope: StatementScope, period: string, memory: StatementAttemptMemory) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['commission-statement-command', ...scope, period],
    retry: false,
    gcTime: 0,
    mutationFn: async (command: StatementCommand) => {
      const identity = `${period}:${command.kind}:${JSON.stringify('body' in command ? command.body : null)}`;
      const key = memory.current.get(identity) ?? crypto.randomUUID();
      memory.current.set(identity, key);
      try {
        const result = await run(scope, period, key, command);
        memory.current.delete(identity);
        await client.invalidateQueries({ queryKey: statementKey(scope, period) });
        return result;
      } catch (error) {
        const inFlight = (error as { code?: unknown } | null)?.code === 'IDEMPOTENCY_KEY_IN_PROGRESS';
        if (hasResponse(error) && !inFlight) memory.current.delete(identity);
        throw error;
      }
    },
  });
}
