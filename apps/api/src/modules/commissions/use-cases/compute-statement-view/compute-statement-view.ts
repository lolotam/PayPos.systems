import {
  buildCanonicalInput,
  buildStatement,
  statementFingerprintInput,
  type StatementBuild,
} from '@pospay/commissions-engine';

import type { CommissionStatementSource } from '../../ports/commission-statement.port.ts';
import type { FingerprintHasher } from '../../ports/fingerprint-hasher.port.ts';

/** ناتج حساب الكشف: صفوف الباني وبصمتا المدخلات والكشف (D-6). */
export interface ComputedStatement {
  readonly build: StatementBuild;
  /** بصمة مدخلات الشهر كلها بما فيها التصحيحات الموقوفة المفتوحة (CS-Q38). */
  readonly inputFingerprint: string;
  /** بصمة الصفوف اللي الباني هيجمّدها ومرفقاتها، بأسمائها الحيّة. */
  readonly statementFingerprint: string;
}

/**
 * يحسب الكشف وبصمتيه من مصادر لقطة واحدة: الباني النقي هو نفسه اللي هيستعمله التجميد (FR-026)، والتجزئة
 * منفذ مُحقن. القراءة (GET) والإنشاء بيمروا من هنا، فبصمة الإنشاء هي بالظبط اللي القراءة بتطلّعها على
 * نفس المدخلات.
 *
 * @param period شهر الكشف بصيغة YYYY-MM
 * @param source مصادر الكشف المقروءة من لقطة واحدة
 * @param hasher منفذ التجزئة
 * @returns الصفوف والبصمتان
 */
export function computeStatement(
  period: string,
  source: CommissionStatementSource,
  hasher: FingerprintHasher,
): ComputedStatement {
  const build = buildStatement({
    period,
    month: source.month,
    employees: source.employees,
    attachments: source.attachments,
    names: source.names,
    correctionLineDetails: source.correctionLineDetails,
  });
  const inputFingerprint = hasher.hash(
    buildCanonicalInput(period, { ...source.month, blocked: source.blocked }),
  );
  const statementFingerprint = hasher.hash(
    statementFingerprintInput(build.rows, build.attachments),
  );
  return { build, inputFingerprint, statementFingerprint };
}
