import {
  packageSaleContext,
  sessionPerformerOptionsQuery,
  type PackageSaleRecorder,
  type PackageSaleSellerOptionPage,
  type SessionPerformerOptionsQuery,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { RecordingContextReadError, type RecordingScope } from './recording-context.query.ts';

export type PackageSaleScope = RecordingScope;

export interface PackageSaleAccessFacts {
  denied: boolean;
  feature: boolean;
  eligible: readonly PackageSaleRecorder[];
}

export interface PackageSaleContextReads {
  place(tx: Tx, scope: PackageSaleScope): Promise<string | null>;
  access(tx: Tx, scope: PackageSaleScope, at: Date): Promise<PackageSaleAccessFacts>;
  options(
    tx: Tx,
    scope: PackageSaleScope,
    query: SessionPerformerOptionsQuery,
  ): Promise<PackageSaleSellerOptionPage>;
}

function authorize(access: PackageSaleAccessFacts): void {
  if (access.denied || access.eligible.length === 0) {
    throw new RecordingContextReadError('FORBIDDEN');
  }
  if (!access.feature) throw new RecordingContextReadError('FEATURE_DISABLED');
}

export class PackageSaleContextQueryHandler {
  constructor(
    private readonly database: TenantWrappers,
    private readonly reads: PackageSaleContextReads,
    private readonly clock: { now(): Date },
  ) {}

  private read<T>(
    scope: PackageSaleScope,
    work: (tx: Tx, at: Date, timezone: string, access: PackageSaleAccessFacts) => Promise<T> | T,
  ): Promise<T> {
    return this.database.withTenant(
      scope.companyId,
      async (tx) => {
        const timezone = await this.reads.place(tx, scope);
        if (timezone === null) throw new RecordingContextReadError('FORBIDDEN');
        const at = this.clock.now();
        const access = await this.reads.access(tx, scope, at);
        authorize(access);
        return work(tx, at, timezone, access);
      },
      { userId: scope.userId },
    );
  }

  context(scope: PackageSaleScope) {
    return this.read(scope, (_tx, at, timezone, access) =>
      packageSaleContext.omit({ customer_entry_scope: true }).parse({
        generated_at: at.toISOString(),
        business_timezone: timezone,
        recorders: access.eligible,
      }),
    );
  }

  sellers(scope: PackageSaleScope, input: SessionPerformerOptionsQuery) {
    const query = sessionPerformerOptionsQuery.parse(input);
    return this.read(scope, (tx, at) =>
      this.reads.options(
        tx,
        scope,
        query.cursor === undefined ? { ...query, occurred_at: at.toISOString() } : query,
      ),
    );
  }
}

export function packageSaleContextValue(
  ...args: ConstructorParameters<typeof PackageSaleContextQueryHandler>
) {
  return new PackageSaleContextQueryHandler(...args);
}
