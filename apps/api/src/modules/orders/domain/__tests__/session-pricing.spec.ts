import { describe, expect, it } from 'vitest';
import { MONEY_MAX, parseMoney } from '@pospay/domain';
import { appendOrdinals, authorizedDiscountAmounts, discountFromPercent, effectiveDiscountBps, lineNet, partitionDiscountLines, sessionTotal } from '../session-pricing.ts';
import type { PreparedSessionLine } from '../session-types.ts';

describe('service session money: independent expected mills', () => {
  it.each([[0n, 0n, 0n], [25000n, 2500n, 22500n], [MONEY_MAX, MONEY_MAX, 0n], [MONEY_MAX, 0n, MONEY_MAX]])('net %s less %s = %s', (price, discount, net) => expect(lineNet(price, discount)).toBe(net));
  it.each([[-1n, 0n], [1000n, -1n], [1000n, 1001n], [MONEY_MAX + 1n, 0n]])('rejects invalid amounts %s/%s', (price, discount) => expect(() => lineNet(price, discount)).toThrow('SESSION_DISCOUNT_INVALID'));
  it.each([[7125n, 1000, 713n], [1n, 4999, 0n], [1n, 5000, 1n], [1n, 5001, 1n], [25000n, 0, 0n], [25000n, 10000, 25000n], [MONEY_MAX, 10000, MONEY_MAX]])('half-up %s at %s bps = %s', (price, bps, discount) => expect(discountFromPercent(price, bps)).toBe(discount));
  it.each([-1, 10001, 1.5, NaN])('rejects invalid percent %s', (bps) => expect(() => discountFromPercent(1000n, bps)).toThrow('SESSION_DISCOUNT_INVALID'));
  // نفس القيم العددية المستقلة في identity؛ لا نستورد دالة سياق الصلاحيات.
  it.each([[0n, 0n, 0], [0n, 5000n, 0], [25000n, 27000n, 0], [25000n, 22500n, 1000], [7125n, 6412n, 1001], [1000n, 0n, 10000], [MONEY_MAX, MONEY_MAX - 1n, 1]])('authority ceiling list %s/net %s = %s', (list, net, expected) => expect(effectiveDiscountBps(list, net)).toBe(expected));
  it('combines lowered price and amount discount', () => expect(effectiveDiscountBps(25000n, lineNet(23000n, 500n))).toBe(1000));
  it.each([[25000n, 25000n, 1000, 22500n, 2500n], [25000n, 22000n, 1000, 22500n, 0n], [7125n, 7125n, 1000, 6413n, 712n], [25000n, 27000n, 1000, 22500n, 4500n], [0n, 0n, 0, 0n, 0n], [25000n, 25000n, 10000, 0n, 25000n]])('display maxima %s/%s/%s', (list, price, limit, minimum_net, max_discount_amount) => expect(authorizedDiscountAmounts(list, price, limit)).toEqual({ minimum_net, max_discount_amount }));
  it('partitions inclusively preserving input order and supports unlimited/zero', () => {
    const lines = [0, 1000, 1001].map((effective_discount_bps) => ({ effective_discount_bps }) as PreparedSessionLine);
    expect(partitionDiscountLines(lines, { source: 'PERSON', bps: 1000 })).toEqual({ accepted: lines.slice(0, 2), rejected: lines.slice(2) });
    expect(partitionDiscountLines(lines, { source: 'OWNER', bps: null }).accepted).toEqual(lines);
    for (const source of ['PERSON', 'BUSINESS', 'NOT_CONFIGURED'] as const) expect(partitionDiscountLines(lines, { source, bps: 0 }).accepted).toEqual([lines[0]]);
    expect(partitionDiscountLines([], { source: 'PERSON', bps: 0 })).toEqual({ accepted: [], rejected: [] });
  });
  it('sums rounded accepted nets; overflow rejects the whole visit', () => {
    expect(sessionTotal([6412n, 22500n])).toBe(28912n);
    expect(sessionTotal([MONEY_MAX, 0n])).toBe(MONEY_MAX);
    expect(() => sessionTotal([MONEY_MAX, 1n])).toThrow('SESSION_TOTAL_TOO_LARGE');
    expect(() => sessionTotal([-1n])).toThrow('SESSION_TOTAL_TOO_LARGE');
    expect(parseMoney('99999999999.999')).toBe(MONEY_MAX);
  });
  it('counts cancelled slots and only accepted additions', () => {
    expect(appendOrdinals(Array.from({ length: 18 }, (_,i) => i+1), 2)).toEqual([19, 20]);
    expect(appendOrdinals([], 3)).toEqual([1, 2, 3]);
    expect(appendOrdinals([1,3],1)).toEqual([4]);
    expect(() => appendOrdinals(Array.from({ length: 19 }, (_,i) => i+1), 2)).toThrow('SESSION_LINE_CAPACITY_EXCEEDED');
    expect(() => appendOrdinals([], 0)).toThrow('SESSION_LINE_CAPACITY_EXCEEDED');
  });
});
