import {
  StatementLogoUnavailable,
  type StatementLogo,
  type StatementLogoRequest,
} from '../../domain/statement-logo.ts';
import type { StatementLogoBytes, StatementLogoStore } from '../../ports/statement-logo.port.ts';
import type { Clock } from '../../ports/verification.port.ts';

// يقرأ شعار البيان: يسجّل الوصول جوه معاملة، ثم يقرأ البايتات من برّهها.
export class ReadStatementLogo {
  constructor(
    private readonly store: StatementLogoStore,
    private readonly bytes: StatementLogoBytes | null,
    private readonly clock: Clock,
  ) {}

  async execute(
    companyId: string,
    request: StatementLogoRequest,
    signal?: AbortSignal,
  ): Promise<StatementLogo | null> {
    if (signal?.aborted) throw new StatementLogoUnavailable('ABORTED');
    if (this.bytes === null) throw new StatementLogoUnavailable('STORAGE_UNAVAILABLE');
    const file = await this.store.record(companyId, request, this.clock.now());
    if (file === null) return null;
    return this.bytes.read(file, signal);
  }
}
