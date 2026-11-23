import type { IncomingCommissionCarry } from './period-input-types.ts';
import type {
  StatementCorrectionSource,
  StatementLineSource,
  StatementSaleSource,
  StatementTipSource,
} from './statement-types.ts';

/**
 * مرجع مصدر صف بند: line:<id>.
 *
 * @param line البند
 * @returns مرجع المصدر
 */
export function lineRef(line: Pick<StatementLineSource, 'lineId'>): string {
  return `line:${line.lineId}`;
}

/**
 * مرجع مصدر صف بيع باقة: sale:<id>.
 *
 * @param sale البيع
 * @returns مرجع المصدر
 */
export function saleRef(sale: Pick<StatementSaleSource, 'saleId'>): string {
  return `sale:${sale.saleId}`;
}

/**
 * مرجع مصدر صف بقشيش: tip:<session>:<method>.
 *
 * @param tip البقشيش
 * @returns مرجع المصدر
 */
export function tipRef(tip: Pick<StatementTipSource, 'sessionId' | 'method'>): string {
  return `tip:${tip.sessionId}:${tip.method}`;
}

/**
 * مرجع مصدر صف تصحيح: correction:<id>، بمعرّف التصحيح نفسه.
 *
 * @param correction التصحيح المستلم
 * @returns مرجع المصدر
 */
export function correctionRef(correction: Pick<StatementCorrectionSource, 'id'>): string {
  return `correction:${correction.id}`;
}

/**
 * مرجع مصدر صف مرحّل داخل: carry:<كشف المصدر>:<النوع>.
 *
 * @param carry المرحّل الداخل
 * @returns مرجع المصدر
 */
export function carryRef(
  carry: Pick<IncomingCommissionCarry, 'sourceStatementId' | 'kind'>,
): string {
  return `carry:${carry.sourceStatementId}:${carry.kind}`;
}
