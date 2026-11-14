import type { Tx } from '@pospay/db';

import type {
  CommissionCorrectionInsertInput,
  CommissionCorrectionScope,
  CommissionFrozenSourcesInput,
  CommissionGenerationInput,
  CommissionMonthProjectionInput,
  CommissionPostedCorrectionsInput,
  CommissionAttachmentSnapshotInput,
} from '../ports/commission-correction.port.ts';
import type { Clock, IdGenerator } from '../ports/commission-line-projection.port.ts';
import {
  readAttachmentSnapshot,
  readFrozenSources,
  readPostedCorrections,
} from './commission-correction-readers.ts';
import { readMonthProjection } from './commission-correction-month-readers.ts';
import { bumpGeneration, insertCorrections } from './commission-correction-writers.ts';

/**
 * يبني نطاق التصحيح على معاملة الحدث نفسها، بنفس الساعة ومولّد الهويات المحقونين.
 * كل القراءات والكتابات بتجري في المعاملة دي، فما فيش معاملة ثانية ولا قفل جديد.
 *
 * @param tx معاملة withTenant الحالية
 * @param ids مولّد هويات الصفوف المحقون
 * @param clock ساعة اللحظة الحالية المحقونة
 * @returns نطاق التصحيح مربوط بالمعاملة
 */
export function createCommissionCorrectionScope(
  tx: Tx,
  ids: IdGenerator,
  clock: Clock,
): CommissionCorrectionScope {
  return {
    readFrozenSources: (input: CommissionFrozenSourcesInput) => readFrozenSources(tx, input),
    readPostedCorrections: (input: CommissionPostedCorrectionsInput) =>
      readPostedCorrections(tx, input),
    readAttachmentSnapshot: (input: CommissionAttachmentSnapshotInput) =>
      readAttachmentSnapshot(tx, input),
    readMonthProjection: (input: CommissionMonthProjectionInput) => readMonthProjection(tx, input),
    bumpGeneration: (input: CommissionGenerationInput) => bumpGeneration(tx, ids, input),
    insertCorrections: (input: CommissionCorrectionInsertInput) =>
      insertCorrections(tx, ids, clock, input),
  };
}
