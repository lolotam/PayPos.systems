import { setDocumentTypeActive } from '../../domain/document-types.ts';
import type {
  DocumentTypeContext,
  DocumentTypeTransactions,
} from '../../ports/document-types.port.ts';

// يخفي النوع عن الوثائق الجديدة دون حذفه؛ الوثائق المسجلة به تبقى كما هي.
export class DeactivateDocumentTypeUseCase {
  constructor(private readonly transactions: DocumentTypeTransactions) {}
  execute(context: DocumentTypeContext & { typeId: string; expectedRevision: number }) {
    return this.transactions.run(context, 'deactivate-document-type', 200, async (scope) => {
      const before = await scope.lock(context.typeId);
      const after = setDocumentTypeActive(before, false, context.expectedRevision);
      await scope.save('deactivate', before, after);
      return after;
    });
  }
}
