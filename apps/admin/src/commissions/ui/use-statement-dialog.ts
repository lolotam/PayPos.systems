'use client';

import type { MessageKey } from '@pospay/i18n';
import { useState } from 'react';
import type { StatementScope } from '../api/commission-statement-client';
import type { StatementCommand } from '../api/statement-commands';
import { useStatementCommand } from '../api/use-statement-command';
import { isOpenBusinessReading, type StatementReading } from '../model/statement-reading';
import { statementVersion } from '../model/statement-version';
import type { StatementPick } from './statement-actions';

const NS = 'commissionStatementScreen';

const DONE: Record<StatementPick, MessageKey> = {
  generate: `${NS}.doneGenerated`,
  review: `${NS}.doneReviewed`,
  return: `${NS}.doneReturned`,
  approve: `${NS}.doneApproved`,
};

/**
 * الحوار المفتوح وكل اللي المستخدم شافه لحظة فتحه: هوية الفتحة (مفتاح المحاولة بيعيش معاها)، ونسخة الكشف،
 * والبصمتين اللي بيتبعتوا للمراجعة والاعتماد. بتتبعت زي ما هي مهما اتحدّث العرض بعد كده.
 */
interface OpenDialog {
  pick: StatementPick;
  openingId: string;
  seenVersion: string;
  fingerprints: { expected_fingerprint: string; expected_statement_fingerprint: string } | null;
}

function openingOf(pick: StatementPick, reading: StatementReading): OpenDialog {
  return {
    pick,
    openingId: crypto.randomUUID(),
    seenVersion: statementVersion(reading),
    fingerprints: isOpenBusinessReading(reading)
      ? {
          expected_fingerprint: reading.current_fingerprint,
          expected_statement_fingerprint: reading.current_statement_fingerprint,
        }
      : null,
  };
}

/** الأمر اللي بيتبعت لما المستخدم يأكد، من الحوار المفتوح وسبب الإرجاع لو في. */
function commandOf(open: OpenDialog, reason: string | undefined): StatementCommand | null {
  if (open.pick === 'generate') return { kind: 'generate' };
  if (open.pick === 'return') return reason === undefined ? null : { kind: 'return', body: { reason } };
  if (open.fingerprints === null) return null;
  return { kind: open.pick, body: open.fingerprints };
}

/**
 * حالة حوار تأكيد أمر الكشف: أي أمر مفتوح، ورسالة النجاح الأخيرة، والأمر الشغّال ورده. الحوار بيتقفل بس
 * لما السيرفر يقبل الأمر، وفتح حوار جديد (أو قفله) بيمسح رد الأمر ومفتاح محاولته.
 */
export function useStatementDialog(scope: StatementScope, period: string, onReload: () => void) {
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [done, setDone] = useState<MessageKey | null>(null);
  const command = useStatementCommand(scope, period);
  const close = () => {
    if (open !== null) command.forget(open.openingId);
    command.reset();
    setOpen(null);
  };
  return {
    open,
    done,
    command,
    close,
    show(pick: StatementPick, reading: StatementReading) {
      if (open !== null) command.forget(open.openingId);
      command.reset();
      setDone(null);
      setOpen(openingOf(pick, reading));
    },
    confirm(reason?: string) {
      const next = open === null ? null : commandOf(open, reason);
      if (open === null || next === null) return;
      const request = { command: next, openingId: open.openingId, seenVersion: open.seenVersion };
      command.mutate(request, {
        onSuccess: () => {
          setDone(DONE[open.pick]);
          setOpen(null);
        },
      });
    },
    reload() {
      close();
      onReload();
    },
  };
}
