import { parseMoney } from '@pospay/domain';
import type { PackageSessionDraft, SessionDraft } from './session-types.ts';

/** بند الطلب كما ترد من العميل: مدفوع بسعره وخصمه، أو من الباقة باستحقاقها. */
export type SessionDraftInput =
  | { service_id: string; price: string; discount: { kind: 'AMOUNT'; amount: string } | { kind: 'PERCENT'; bps: number };
      performers: readonly { employee_id: string; share_bps?: number | undefined }[];
      discount_proposal_id?: string | undefined }
  | { service_id: string; package: { entitlement_id: string };
      performers: readonly { employee_id: string; share_bps?: number | undefined }[] };

/**
 * يفصل بنود الطلب إلى مسودتين: مدفوعة تحمل المال، ومسودات باقة تحمل الاستحقاق.
 * ومعرّف الموافقة ينتقل كما أرسله العميل، فالسطر فوق الحد يعرف أي موافقة يطلب.
 * وترتيب كل بند في الطلب محفوظ، فهو أساس الأرقام وترتيب العرض.
 *
 * @param lines بنود الطلب كما تحقّق شكلها
 * @returns المسودات المدفوعة والمسودات من الباقة، كل واحدة تحمل ترتيبها في الطلب
 */
export function sessionDrafts(lines: readonly SessionDraftInput[]): { paid: SessionDraft[]; packages: PackageSessionDraft[] } {
  const paid: SessionDraft[] = [];
  const packages: PackageSessionDraft[] = [];
  lines.forEach((line, input_index) => {
    if ('package' in line) {
      packages.push({ input_index, service_id: line.service_id, entitlement_id: line.package.entitlement_id, performers: line.performers });
      return;
    }
    paid.push({ input_index, service_id: line.service_id, price: parseMoney(line.price),
      discount: line.discount.kind === 'AMOUNT' ? { kind: 'AMOUNT', amount: parseMoney(line.discount.amount) } : line.discount,
      performers: line.performers,
      ...(line.discount_proposal_id === undefined ? {} : { approval_proposal_id: line.discount_proposal_id }) });
  });
  return { paid, packages };
}
