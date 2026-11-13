import { parseMoney } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { CommissionAttachmentInterval } from '../domain/commission-correction-attribution.ts';
import { CommissionCorrectionStepInputError } from '../domain/errors.ts';
import type {
  CommissionCorrectionKind,
  CommissionFrozenSource,
  CommissionPostedCorrection,
} from '../domain/commission-correction-step.ts';
import type {
  CommissionAttachmentSnapshotInput,
  CommissionFrozenSourcesInput,
  CommissionPostedCorrectionsInput,
} from '../ports/commission-correction.port.ts';

type FrozenSourceRow = {
  sourceRef: string;
  kind: string;
  amount: string;
  sourceBranchId: string | null;
  sourceBusinessDate: string | null;
  attachedBranchIds: string[];
};

type PostedCorrectionRow = Omit<FrozenSourceRow, 'sourceBranchId' | 'sourceBusinessDate'> & {
  sourceBranchId: string;
  sourceBusinessDate: string;
  sourcePeriod: string;
};

type AttachmentRow = {
  branchId: string;
  attachedFrom: string;
  attachedTo: string | null;
};

export async function readFrozenSources(
  tx: Tx,
  input: CommissionFrozenSourcesInput,
): Promise<readonly CommissionFrozenSource[]> {
  const rows = await tx.execute<FrozenSourceRow>(sql`SELECT
    source_ref AS "sourceRef", kind AS "kind", amount::text AS amount,
    source_branch_id AS "sourceBranchId", source_business_date::text AS "sourceBusinessDate",
    attached_branch_ids AS "attachedBranchIds"
    FROM commission_statement_lines
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND statement_id = ${input.statementId}::uuid AND employee_id = ${input.employeeId}::uuid
      AND kind IN ('COMMISSION','SALE','TIP_CARD','TIP_CASH')
    ORDER BY source_ref`);
  return rows.map((row) => {
    if (row.sourceBranchId === null || row.sourceBusinessDate === null) {
      throw new CommissionCorrectionStepInputError(
        'FROZEN_SOURCE_ATTRIBUTION_MISSING',
        row.sourceRef,
        row.kind,
      );
    }
    return {
      sourceRef: row.sourceRef,
      kind: row.kind as CommissionCorrectionKind,
      amount: parseMoney(row.amount),
      attribution: {
        sourceBranchId: row.sourceBranchId,
        sourceBusinessDate: row.sourceBusinessDate,
        attachedBranchIds: [...row.attachedBranchIds],
      },
    };
  });
}

export async function readPostedCorrections(
  tx: Tx,
  input: CommissionPostedCorrectionsInput,
): Promise<readonly CommissionPostedCorrection[]> {
  const rows = await tx.execute<PostedCorrectionRow>(sql`SELECT
    source_ref AS "sourceRef", kind AS "kind", amount::text AS amount,
    source_branch_id AS "sourceBranchId", source_business_date::text AS "sourceBusinessDate",
    attached_branch_ids AS "attachedBranchIds", source_period AS "sourcePeriod"
    FROM commission_corrections
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND employee_id = ${input.employeeId}::uuid AND source_period = ${input.sourcePeriod}
    ORDER BY source_ref, generation`);
  return rows.map((row) => ({
    sourceRef: row.sourceRef,
    kind: row.kind as CommissionCorrectionKind,
    amount: parseMoney(row.amount),
    attribution: {
      sourceBranchId: row.sourceBranchId,
      sourceBusinessDate: row.sourceBusinessDate,
      attachedBranchIds: [...row.attachedBranchIds],
    },
  }));
}

export async function readAttachmentSnapshot(
  tx: Tx,
  input: CommissionAttachmentSnapshotInput,
): Promise<readonly CommissionAttachmentInterval[]> {
  const rows = await tx.execute<AttachmentRow>(sql`SELECT
    branch_id AS "branchId", attached_from::text AS "attachedFrom",
    attached_to::text AS "attachedTo"
    FROM commission_statement_attachments
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND statement_id = ${input.statementId}::uuid AND employee_id = ${input.employeeId}::uuid
    ORDER BY branch_id, attached_from`);
  return rows.map((row) => ({
    branchId: row.branchId,
    attachedFrom: row.attachedFrom,
    attachedTo: row.attachedTo,
  }));
}
