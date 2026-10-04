import type { RecordEmployeeDocumentInput } from '@pospay/contracts';
import { DocumentError } from '../../domain/document-types.ts';
import {
  documentToday,
  documentView,
  replaceCurrentDocument,
  requireDocumentFile,
  validateDocumentRecord,
} from '../../domain/employee-documents.ts';
import type { DocumentClock, DocumentIds } from '../../ports/document-types.port.ts';
import type {
  EmployeeDocumentContext,
  EmployeeDocumentTransactions,
} from '../../ports/employee-documents.port.ts';
export { DocumentError } from '../../domain/document-types.ts';

// يربط ملفاً موثقاً رفعه المدير بالموظف ويستبدل الوثيقة الحالية من نفس النوع.
export class RecordEmployeeDocumentUseCase {
  constructor(
    private readonly transactions: EmployeeDocumentTransactions,
    private readonly ids: DocumentIds,
    private readonly clock: DocumentClock,
  ) {}
  execute(context: EmployeeDocumentContext & { input: RecordEmployeeDocumentInput }) {
    return this.transactions.run(context, async (scope) => {
      const { input } = context;
      const objectKey = requireDocumentFile(await scope.file(input.file_id), context);
      const { type, expiresOn } = validateDocumentRecord(
        await scope.type(input.type_code),
        input.expires_on,
      );
      if (await scope.recorded(objectKey))
        throw new DocumentError('DOCUMENT_FILE_ALREADY_RECORDED');
      const now = this.clock.now();
      const { replaced, recorded } = replaceCurrentDocument(await scope.current(type.code), {
        id: this.ids.newId(),
        business_id: context.businessId,
        employee_id: context.employeeId,
        type_code: type.code,
        object_key: objectKey,
        expires_on: expiresOn,
        uploaded_by: context.userId,
        recorded_at: now.toISOString(),
        replaced_at: null,
      });
      await scope.save(replaced, recorded);
      return documentView(recorded, type, documentToday(now, scope.timeZone));
    });
  }
}
