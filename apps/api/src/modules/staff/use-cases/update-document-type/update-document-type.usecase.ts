import type { UpdateDocumentTypeInput } from '@pospay/contracts';
import { reviseDocumentType } from '../../domain/document-types.ts';
import type {
  DocumentTypeContext,
  DocumentTypeTransactions,
} from '../../ports/document-types.port.ts';

// يعدل اسم النوع وتنبيهه؛ الوثائق المسجلة تأخذ التنبيه الجديد في شارتها فوراً.
export class UpdateDocumentTypeUseCase {
  constructor(private readonly transactions: DocumentTypeTransactions) {}
  execute(context: DocumentTypeContext & { typeId: string; input: UpdateDocumentTypeInput }) {
    return this.transactions.run(context, 'update-document-type', 200, async (scope) => {
      const before = await scope.lock(context.typeId);
      const after = reviseDocumentType(before, context.input, context.input.expected_revision);
      await scope.save('update', before, after);
      return after;
    });
  }
}
