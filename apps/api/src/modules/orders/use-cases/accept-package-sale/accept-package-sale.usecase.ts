import type { AcceptedPackageSale, SellPackageInput } from '@pospay/contracts';
import { pendingPackageSale } from '../../domain/package-sale-request.ts';
import { resolveSessionRecorder } from '../../domain/session-authority.ts';
import type {
  PackageSaleRequestTransaction,
  PackageSaleRequestTransactions,
} from '../../ports/package-sale-request.port.ts';
import type {
  Clock,
  IdGenerator,
  SessionWriteContext,
} from '../../ports/service-session-transactions.port.ts';

type AcceptPackageSaleContext = SessionWriteContext & { input: SellPackageInput };

/** يقبل بيع باقة كطلب معلق ويثبت لقطته وحدثه ورده في معاملة واحدة. */
export class AcceptPackageSaleUseCase {
  constructor(
    private readonly transactions: PackageSaleRequestTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: AcceptPackageSaleContext): Promise<AcceptedPackageSale> {
    return this.transactions.run(context, async (tx) => {
      const result = await tx.idempotent(() => this.accept(tx, context));
      if (result.replayed) {
        await tx.access.lock();
        await this.authorize(tx, this.clock.now(), context);
      }
      return result.body;
    });
  }

  private async accept(
    tx: PackageSaleRequestTransaction,
    context: AcceptPackageSaleContext,
  ): Promise<AcceptedPackageSale> {
    await tx.access.lock();
    const at = this.clock.now();
    const membershipId = await this.authorize(tx, at, context);
    const limit = await tx.discountLimit.read(membershipId);
    const requestId = this.ids.newId();
    const request = pendingPackageSale(context.input, {
      id: requestId,
      companyId: context.companyId,
      businessId: context.businessId,
      branchId: context.branchId,
      recorderUserId: context.userId,
      recorderMembershipId: membershipId,
      limitBps: limit.bps,
      recordedAt: at,
    });
    await tx.insertPending(request);
    await tx.publishRequested(requestId);
    return { sale_request_id: requestId };
  }

  private async authorize(
    tx: PackageSaleRequestTransaction,
    at: Date,
    context: AcceptPackageSaleContext,
  ): Promise<string> {
    const access = await tx.access.read(at);
    return resolveSessionRecorder(
      access,
      context.input.recorder_membership_id,
      undefined,
      context.userId,
    );
  }
}

export { SessionError } from '../../domain/session-error.ts';
