import { affectedCommissionLineEmployees } from '../../domain/commission-lines.ts';
import type {
  CommissionLineSnapshot,
  CommissionPeriodEmployee,
} from '../../domain/commission-line-types.ts';
import type { CommissionLineProjectionScope } from '../../ports/commission-line-projection.port.ts';

/** يشتق موظفات البنود اللاتي يحتجن تصحيحاً في الشهور المغلقة من الصفوف المحفوظة والجديدة. */
export async function readCommissionLineCorrectionEmployees(
  scope: CommissionLineProjectionScope,
  lines: readonly CommissionLineSnapshot[],
  closedPeriods: readonly string[],
): Promise<readonly CommissionPeriodEmployee[]> {
  if (closedPeriods.length === 0) return [];
  const stored = await scope.readLinePerformers(lines.map((line) => line.lineId));
  return affectedCommissionLineEmployees(lines, stored, closedPeriods);
}
