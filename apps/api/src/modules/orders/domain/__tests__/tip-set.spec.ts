import { MONEY_MAX } from '@pospay/domain';
import { describe, expect, it } from 'vitest';
import { validateTipSet, type TipEntry } from '../tip-set.ts';
import { codeOf, entry, person } from './fixtures/tip-set.ts';

const cashier = 'cashier';

describe('validateTipSet shape and first write', () => {
  it('accepts an empty first set as a no-op', () => {
    expect(
      validateTipSet({ actor_user_id: cashier, current: [], requested: [], people: [] }),
    ).toEqual({
      added: [],
      changed: [],
      removed: [],
      carried: [],
      total_cash: 0n,
      total_card: 0n,
      changed_anything: false,
    });
  });

  it('accepts the first entry of a visit', () => {
    const requested = [entry('sara', 'CASH', 1_000n)];
    const result = validateTipSet({
      actor_user_id: cashier,
      current: [],
      requested,
      people: [person('sara')],
    });
    expect(result.added).toEqual(requested);
    expect(result.changed_anything).toBe(true);
    expect(result.total_cash).toBe(1_000n);
    expect(result.total_card).toBe(0n);
  });

  it('accepts the TP-01 example', () => {
    const result = validateTipSet({
      actor_user_id: 'mona',
      current: [],
      requested: [entry('sara', 'CARD', 6_000n), entry('heba', 'CARD', 2_000n)],
      people: [person('sara'), person('heba')],
    });
    expect(result.added).toEqual([entry('heba', 'CARD', 2_000n), entry('sara', 'CARD', 6_000n)]);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.total_cash).toBe(0n);
    expect(result.total_card).toBe(8_000n);
    expect(result.changed_anything).toBe(true);
  });
});

describe('validateTipSet shape', () => {
  it('rejects two entries for the same employee and method, including differently cased ids', () => {
    const people = [person('sara')];
    const requested = [entry('Sara', 'CASH', 1n), entry('sara', 'CASH', 2n)];
    expect(
      codeOf(() => validateTipSet({ actor_user_id: cashier, current: [], requested, people })),
    ).toBe('VALIDATION_FAILED');
  });

  it('allows cash and card for the same employee', () => {
    const requested = [entry('sara', 'CASH', 1n), entry('SARA', 'CARD', 2n)];
    const result = validateTipSet({
      actor_user_id: cashier,
      current: [],
      requested,
      people: [person('sara')],
    });
    expect(result.added).toEqual([entry('SARA', 'CARD', 2n), entry('sara', 'CASH', 1n)]);
    expect(result.total_cash).toBe(1n);
    expect(result.total_card).toBe(2n);
  });

  it('rejects a zero, a negative and an amount above MONEY_MAX', () => {
    const people = [person('sara')];
    for (const amount of [0n, -1n, MONEY_MAX + 1n]) {
      expect(
        codeOf(() =>
          validateTipSet({
            actor_user_id: cashier,
            current: [],
            requested: [entry('sara', 'CASH', amount)],
            people,
          }),
        ),
      ).toBe('VALIDATION_FAILED');
    }
  });
});

describe('validateTipSet totals', () => {
  it('rejects a cash total above the limit and a card total on its own', () => {
    const people = [person('sara'), person('heba')];
    const over = (method: TipEntry['method']) => [
      entry('sara', method, MONEY_MAX),
      entry('heba', method, 1n),
    ];
    expect(
      codeOf(() =>
        validateTipSet({ actor_user_id: cashier, current: [], requested: over('CASH'), people }),
      ),
    ).toBe('TIP_TOTAL_TOO_LARGE');
    expect(
      codeOf(() =>
        validateTipSet({ actor_user_id: cashier, current: [], requested: over('CARD'), people }),
      ),
    ).toBe('TIP_TOTAL_TOO_LARGE');
  });

  it('allows each method to sit on the limit when the other method is separate', () => {
    const result = validateTipSet({
      actor_user_id: cashier,
      current: [],
      requested: [entry('sara', 'CASH', MONEY_MAX), entry('heba', 'CARD', MONEY_MAX)],
      people: [person('sara'), person('heba')],
    });
    expect(result.total_cash).toBe(MONEY_MAX);
    expect(result.total_card).toBe(MONEY_MAX);
  });
});

describe('validateTipSet classification', () => {
  it('classifies a mixed request in employee then method order', () => {
    const result = validateTipSet({
      actor_user_id: 'mona',
      current: [
        entry('sara', 'CASH', 1_000n),
        entry('sara', 'CARD', 2_000n),
        entry('heba', 'CASH', 3_000n),
      ],
      requested: [
        entry('Sara', 'CASH', 1_000n),
        entry('sara', 'CARD', 2_500n),
        entry('nour', 'CARD', 4_000n),
      ],
      people: [person('sara'), person('heba'), person('nour')],
    });
    expect(result.carried).toEqual([entry('Sara', 'CASH', 1_000n)]);
    expect(result.changed).toEqual([entry('sara', 'CARD', 2_500n)]);
    expect(result.removed).toEqual([entry('heba', 'CASH', 3_000n)]);
    expect(result.added).toEqual([entry('nour', 'CARD', 4_000n)]);
    expect(result.total_cash).toBe(1_000n);
    expect(result.total_card).toBe(6_500n);
    expect(result.changed_anything).toBe(true);
  });

  it('detects a no-op when the set is reordered or the ids only change case', () => {
    const result = validateTipSet({
      actor_user_id: 'mona',
      current: [entry('Sara', 'CARD', 2_000n), entry('heba', 'CASH', 1_000n)],
      requested: [entry('heba', 'CASH', 1_000n), entry('sara', 'CARD', 2_000n)],
      people: [person('sara', { active: false }), person('heba', { active: false })],
    });
    expect(result.changed_anything).toBe(false);
    expect(result.added).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.carried).toEqual([entry('heba', 'CASH', 1_000n), entry('sara', 'CARD', 2_000n)]);
  });

  it('removes every tip when the requested set is empty and identity allows it', () => {
    const result = validateTipSet({
      actor_user_id: cashier,
      current: [entry('sara', 'CARD', 6_000n), entry('heba', 'CARD', 2_000n)],
      requested: [],
      people: [person('sara'), person('heba')],
    });
    expect(result.removed).toEqual([entry('heba', 'CARD', 2_000n), entry('sara', 'CARD', 6_000n)]);
    expect(result.changed_anything).toBe(true);
    expect(result.total_card).toBe(0n);
  });
});
