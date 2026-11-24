'use client';

import type { MarkCommissionStatementPaidInput } from '@pospay/contracts';
import { useState } from 'react';
import type { StatementScope } from '../api/commission-statement-client';
import { useStatementCommand } from '../api/use-statement-command';
import type { StatementReading } from '../model/statement-reading';
import { statementVersion } from '../model/statement-version';

export function useStatementPayDialog(scope: StatementScope, period: string) {
  const command = useStatementCommand(scope, period);
  const [open, setOpen] = useState<{ openingId: string; seenVersion: string; reading: StatementReading } | null>(null);
  const [done, setDone] = useState(false);
  const close = () => {
    if (open !== null) command.forget(open.openingId);
    command.reset();
    setOpen(null);
  };
  return {
    open, done, command, close,
    show(reading: StatementReading) {
      command.reset();
      setDone(false);
      setOpen({ openingId: crypto.randomUUID(), seenVersion: statementVersion(reading), reading });
    },
    confirm(body: MarkCommissionStatementPaidInput) {
      if (open === null) return;
      command.mutate({ command: { kind: 'pay', body }, openingId: open.openingId, seenVersion: open.seenVersion }, {
        onSuccess: () => { setDone(true); setOpen(null); },
      });
    },
  };
}
