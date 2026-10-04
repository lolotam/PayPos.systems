import { setDocumentTypeActive } from '../../domain/document-types.ts';
import type {
  DocumentTypeContext,
  DocumentTypeTransactions,
} from '../../ports/document-types.port.ts';

// يعيد نوعاً موقوفاً لقائمة الاختيار عند تسجيل وثيقة جديدة.
export class ReactivateDocumentTypeUseCase {
  constructor(private readonly transactions: DocumentTypeTransactions) {}
  execute(context: DocumentTypeContext & { typeId: string; expectedRevision: number }) {
    return this.transactions.run(context, 'reactivate-document-type', 200, async (scope) => {
      const before = await scope.lock(context.typeId);
      const after = setDocumentTypeActive(before, true, context.expectedRevision);
      await scope.save('reactivate', before, after);
      return after;
    });
  }
}
