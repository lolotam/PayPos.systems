import type { CreateDocumentTypeInput } from '@pospay/contracts';
import { newDocumentType } from '../../domain/document-types.ts';
import type {
  DocumentIds,
  DocumentTypeContext,
  DocumentTypeTransactions,
} from '../../ports/document-types.port.ts';
export { DocumentError } from '../../domain/document-types.ts';

// يضيف نوع وثيقة للشركة بكود ثابت يولده السيرفر.
export class CreateDocumentTypeUseCase {
  constructor(
    private readonly transactions: DocumentTypeTransactions,
    private readonly ids: DocumentIds,
  ) {}
  execute(context: DocumentTypeContext & { input: CreateDocumentTypeInput }) {
    return this.transactions.run(context, 'create-document-type', 201, async (scope) => {
      const after = newDocumentType(this.ids.newId(), context.input, await scope.count());
      await scope.save('create', null, after);
      return after;
    });
  }
}
