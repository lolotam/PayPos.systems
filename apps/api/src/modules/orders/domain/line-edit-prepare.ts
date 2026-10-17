import { moneyToString } from '@pospay/domain';
import { SessionError } from './session-error.ts';
import {
  authorizedDiscountAmounts,
  discountFromPercent,
  effectiveDiscountBps,
  lineNet,
  sessionTotal,
} from './session-pricing.ts';
import type { SessionLimit } from './session-types.ts';

/** السعر والخصم المطلوبان قبل تحويل النسبة إلى مبلغ مخزّن. */
export interface LineEditRequest {
  list_price: bigint;
  current: { price: bigint; discount: bigint };
  requested: {
    price: bigint;
    discount: { kind: 'AMOUNT'; amount: bigint } | { kind: 'PERCENT'; bps: number };
  };
  limit: SessionLimit;
  other_active_nets: readonly bigint[];
}

/** نتيجة مقبولة؛ الحد هو حد المحررة كما وصل ليُحفظ على السطر. */
export interface PreparedLineEdit {
  price: bigint;
  discount: bigint;
  net: bigint;
  effective_discount_bps: number;
  limit: SessionLimit;
}

/** حالة السطر ونسخته؛ النسخة القديمة تُرفض حتى لو كان السطر ملغى. */
export interface EditableServiceLine {
  status: 'ACTIVE' | 'CANCELLED';
  revision: number;
}

/**
 * يرفض النسخة القديمة قبل حالة الإلغاء حتى لا يختفي السباق خلف «السطر ملغي».
 * التفاصيل تحمل رقم النسخة الحالي فقط، من غير أي مبلغ.
 *
 * @param line حالة السطر ونسخته المحفوظة
 * @param expectedRevision النسخة التي تتوقعها الطالبة
 * @returns لا شيء؛ الاختلاف أو الإلغاء يرفض
 */
export function assertLineEditable(line: EditableServiceLine, expectedRevision: number): void {
  if (line.revision !== expectedRevision) {
    throw new SessionError('SESSION_LINE_REVISION_STALE', { current_revision: line.revision });
  }
  if (line.status === 'CANCELLED') throw new SessionError('SESSION_LINE_NOT_EDITABLE');
}

/**
 * يحوّل الخصم المطلوب إلى مبلغ مخزّن ثم يفحص «لا تغيير» وحد المحررة وإجمالي الزيارة.
 * النسبة تُحسب على السعر المطلوب، وتغيّر الحد وحده ليس تعديلاً يستحق نسخة جديدة.
 * تفاصيل تجاوز الحد تسمّي الحد المطبَّق limit_bps_applied كما سمّاه LE-05.
 *
 * @param input القائمة والسعر الحالي والمطلوب وحد المحررة وصوافي البنود الأخرى
 * @returns السعر والخصم والصافي ونسبة الخصم الفعلي والحد كما وصل
 */
export function prepareLineEdit(input: LineEditRequest): PreparedLineEdit {
  const price = input.requested.price;
  const discount = storedDiscount(price, input.requested.discount);
  const net = lineNet(price, discount);
  if (price === input.current.price && discount === input.current.discount) {
    throw new SessionError('SESSION_EDIT_NO_CHANGE');
  }
  const effective_discount_bps = effectiveDiscountBps(input.list_price, net);
  if (input.limit.source !== 'OWNER' && effective_discount_bps > input.limit.bps) {
    refuseAboveLimit(input.list_price, price, discount, net, effective_discount_bps, input.limit);
  }
  sessionTotal([...input.other_active_nets, net]);
  return { price, discount, net, effective_discount_bps, limit: input.limit };
}

function storedDiscount(price: bigint, discount: LineEditRequest['requested']['discount']): bigint {
  return discount.kind === 'PERCENT' ? discountFromPercent(price, discount.bps) : discount.amount;
}

function refuseAboveLimit(
  listPrice: bigint,
  price: bigint,
  discount: bigint,
  net: bigint,
  effectiveDiscountBpsValue: number,
  limit: Exclude<SessionLimit, { source: 'OWNER' }>,
): never {
  const amounts = authorizedDiscountAmounts(listPrice, price, limit.bps);
  throw new SessionError('SESSION_DISCOUNT_ABOVE_LIMIT', {
    price: moneyToString(price),
    discount: moneyToString(discount),
    net: moneyToString(net),
    effective_discount_bps: effectiveDiscountBpsValue,
    limit_bps_applied: limit.bps,
    limit_source: limit.source,
    minimum_net: moneyToString(amounts.minimum_net),
    max_discount_amount: moneyToString(amounts.max_discount_amount),
  });
}
