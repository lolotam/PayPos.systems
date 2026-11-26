import type {
  CustomerImportCommitAccepted,
  CustomerImportPreview,
  CustomerImportRow as CustomerImportPublicRow,
  CustomerImportTemplate,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  CUSTOMER_IMPORT_CONTENT_TYPE,
  CUSTOMER_IMPORT_MAX_BYTES,
  CUSTOMER_IMPORT_PREVIEW_TTL_MS,
  CustomerImportError,
  customerImportCallingCode,
  decideCustomerImportCommit,
  validateCustomerImportFile,
  type CustomerImportCellValues,
  type CustomerImportRow,
} from '../../domain/customer-import.ts';
import {
  finalizeCustomerImportRows,
  validateCustomerImportSheet,
} from '../../domain/customer-import-rows.ts';
import type {
  CustomerImportScope,
  CustomerImportSheetReader,
  CustomerImportTemplateBuilder,
  CustomerImportTransactions,
} from '../../ports/customer-import.port.ts';

export { CustomerImportError } from '../../domain/customer-import.ts';
export type { CustomerImportScope } from '../../ports/customer-import.port.ts';

const PREVIEW_ROWS_PAGE = 20;
const CELL_VALUES: CustomerImportCellValues = {
  yes: t('ar', 'customerImport.value_yes'),
  no: t('ar', 'customerImport.value_no'),
  male: t('ar', 'customerImport.value_male'),
  female: t('ar', 'customerImport.value_female'),
};

export interface CustomerImportCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly scope: CustomerImportScope;
}
export interface PreviewCustomerImportCommand extends CustomerImportCommand {
  readonly fileId: string;
}
export interface CommitCustomerImportCommand extends CustomerImportCommand {
  readonly previewId: string;
  readonly key: string;
  readonly fingerprint: string;
}

const publicRow = (row: CustomerImportRow): CustomerImportPublicRow => ({
  row: row.row,
  masked_phone: row.masked_phone,
  name: row.name,
  locale: row.locale,
  status: row.status,
  warning: row.warning,
});

export class GetCustomerImportTemplateUseCase {
  constructor(
    private readonly transactions: Pick<CustomerImportTransactions, 'runFacts'>,
    private readonly builder: CustomerImportTemplateBuilder,
  ) {}

  async execute(command: CustomerImportCommand): Promise<CustomerImportTemplate> {
    await this.transactions.runFacts(command, async () => undefined);
    return {
      file_name: 'customers-import-template.xlsx',
      content_type: CUSTOMER_IMPORT_CONTENT_TYPE,
      content_base64: await this.builder.build(),
    };
  }
}

export class PreviewCustomerImportUseCase {
  constructor(
    private readonly transactions: CustomerImportTransactions,
    private readonly bytes: { read(key: string, maxBytes: number): Promise<Uint8Array> },
    private readonly sheets: CustomerImportSheetReader,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: PreviewCustomerImportCommand): Promise<CustomerImportPreview> {
    const facts = await this.transactions.runFacts(
      { ...command, fileId: command.fileId },
      async (scope) => ({
        callingCode: customerImportCallingCode(scope.countryCode),
        storageKey: validateCustomerImportFile(scope.facts, scope.businessId, command.userId),
      }),
    );
    const bytes = await this.bytes.read(facts.storageKey, CUSTOMER_IMPORT_MAX_BYTES + 1);
    const validated = validateCustomerImportSheet(
      await this.sheets.read(bytes),
      facts.callingCode,
      CELL_VALUES,
    );
    const previewId = this.ids.newId();
    const at = this.clock.now();
    const expiresAt = new Date(at.getTime() + CUSTOMER_IMPORT_PREVIEW_TTL_MS).toISOString();
    return this.transactions.runSave({ ...command, fileId: command.fileId }, async (scope) => {
      const phones = validated.candidates
        .map((c) => c.phone)
        .filter((p): p is string => p !== null);
      const { rows, errors } = finalizeCustomerImportRows(
        validated.candidates,
        await scope.existingPhones(phones),
      );
      const rowCount = validated.candidates.length;
      await scope.save({
        id: previewId,
        businessId: scope.businessId,
        fileId: command.fileId,
        createdAt: at.toISOString(),
        expiresAt,
        rowCount,
        rows,
        errors,
      });
      await scope.auditFileAccess(command.fileId);
      const page = rows.slice(0, PREVIEW_ROWS_PAGE);
      const last = page.at(-1);
      return {
        preview_id: previewId,
        row_count: rowCount,
        new_count: rows.filter((r) => r.status === 'new').length,
        existing_count: rows.filter((r) => r.status === 'existing').length,
        error_count: errors.length,
        errors: [...errors],
        rows: page.map(publicRow),
        next_cursor: page.length < rows.length && last !== undefined ? String(last.row) : null,
      };
    });
  }
}

export class CommitCustomerImportUseCase {
  constructor(
    private readonly transactions: Pick<CustomerImportTransactions, 'runCommit'>,
    private readonly clock: Clock,
  ) {}

  execute(command: CommitCustomerImportCommand): Promise<CustomerImportCommitAccepted> {
    return this.transactions.runCommit(command, async (scope) => {
      const preview = await scope.load(command.previewId);
      if (preview === null) throw new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND');
      const at = this.clock.now();
      if (decideCustomerImportCommit(preview, command.userId, scope.businessId, at) === 'request') {
        await scope.request(preview.id, at.toISOString());
      }
      return { preview_id: preview.id };
    });
  }
}
