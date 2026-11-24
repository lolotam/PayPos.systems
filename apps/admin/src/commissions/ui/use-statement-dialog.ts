'use client';

import type { MessageKey } from '@pospay/i18n';
import { useState } from 'react';
import type { StatementScope } from '../api/commission-statement-client';
import { useStatementCommand, type StatementAttemptMemory, type StatementCommand } from '../api/use-statement-command';
import { isBusinessReading, type StatementReading } from '../model/statement-reading';
import type { StatementPick } from './statement-actions';

const NS = 'commissionStatementScreen';

const DONE: Record<StatementPick, MessageKey> = {
  generate: `${NS}.doneGenerated`,
  review: `${NS}.doneReviewed`,
  return: `${NS}.doneReturned`,
};

/** الحوار المفتوح والبصمتين اللي المراجع شافهم لحظة فتحه، بتتبعت زي ما هي مهما اتحدّث العرض بعدها. */
interface OpenDialog {
  pick: StatementPick;
  fingerprints: { expected_fingerprint: string; expected_statement_fingerprint: string } | null;
}

function fingerprintsOf(reading: StatementReading): OpenDialog['fingerprints'] {
  return isBusinessReading(reading)
    ? {
        expected_fingerprint: reading.current_fingerprint,
        expected_statement_fingerprint: reading.current_statement_fingerprint,
      }
    : null;
}

/** الأمر اللي بيتبعت لما المستخدم يأكد، من الحوار المفتوح وسبب الإرجاع لو في. */
function commandOf(open: OpenDialog, reason: string | undefined): StatementCommand | null {
  if (open.pick === 'generate') return { kind: 'generate' };
  if (open.pick === 'review')
    return open.fingerprints === null ? null : { kind: 'review', body: open.fingerprints };
  return reason === undefined ? null : { kind: 'return', body: { reason } };
}

/**
 * حالة حوار تأكيد أمر الكشف: أي أمر مفتوح، ورسالة النجاح الأخيرة، والأمر الشغّال ورده. الحوار بيتقفل بس
 * لما السيرفر يقبل الأمر، وفتح حوار جديد بيمسح رد الأمر اللي قبله.
 */
export function useStatementDialog(
  scope: StatementScope,
  period: string,
  memory: StatementAttemptMemory,
  onReload: () => void,
) {
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [done, setDone] = useState<MessageKey | null>(null);
  const command = useStatementCommand(scope, period, memory);
  const close = () => {
    command.reset();
    setOpen(null);
  };
  return {
    open,
    done,
    command,
    close,
    show(pick: StatementPick, reading: StatementReading) {
      command.reset();
      setDone(null);
      setOpen({ pick, fingerprints: fingerprintsOf(reading) });
    },
    confirm(reason?: string) {
      const next = open === null ? null : commandOf(open, reason);
      if (open === null || next === null) return;
      command.mutate(next, {
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
