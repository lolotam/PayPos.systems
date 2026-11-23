import { describe, expect, it } from 'vitest';

import { buildStatement } from '../statement-builder.ts';
import type { StatementBuildInput, StatementNames } from '../statement-types.ts';
import { at, octoberInput, octoberRows, SALMIYA, SARA } from './statement-fixtures.ts';

/** أسماء أكتوبر من غير خدمة بعينها أو من غير عميل بعينه، زي قارئ فاته اسم. */
function withoutNames(drop: { service?: string; customer?: string }): StatementNames {
  const { names } = octoberInput();
  return {
    ...names,
    services: new Map([...names.services].filter(([id]) => id !== drop.service)),
    customers: new Map([...names.customers].filter(([id]) => id !== drop.customer)),
  };
}

describe('a line row freezes the names the reader supplied (D-20)', () => {
  it('refuses a line whose service name was not read', () => {
    const names = withoutNames({ service: 'service-1' });
    expect(() => buildStatement({ ...octoberInput(), names })).toThrow(
      'Statement service name is missing',
    );
  });

  it('refuses a line with a customer id whose customer name was not read', () => {
    const names = withoutNames({ customer: 'customer-1' });
    expect(() => buildStatement({ ...octoberInput(), names })).toThrow(
      'Statement customer name is missing',
    );
  });

  it('accepts a line with no customer and a service with no Arabic name', () => {
    const rows = octoberRows();
    const input = octoberInput({ ...rows, lines: [at(rows.lines, 1)], corrections: [] });
    const names = { ...input.names, customers: new Map<string, string>() };
    const line = buildStatement({ ...input, names }).rows.find((row) => row.kind === 'COMMISSION');
    expect(line).toMatchObject({
      serviceNameAr: null,
      serviceNameEn: 'Colour',
      customerId: null,
      customerName: null,
    });
  });

  it('does not need the names of a line it does not freeze', () => {
    const rows = octoberRows();
    const cancelled = { ...at(rows.lines, 0), status: 'CANCELLED' as const };
    const input = octoberInput({ ...rows, lines: [cancelled], corrections: [] });
    const names = withoutNames({ service: 'service-1', customer: 'customer-1' });
    expect(() => buildStatement({ ...input, names })).not.toThrow();
  });
});

describe('a line correction freezes the names of its line head (D-20)', () => {
  it('refuses a head whose service name was not read', () => {
    const names = withoutNames({ service: 'service-1' });
    const rows = octoberRows();
    const input = octoberInput({ ...rows, lines: [] });
    expect(() => buildStatement({ ...input, names })).toThrow('Statement service name is missing');
  });

  it('refuses a head with a customer id whose customer name was not read', () => {
    const names = withoutNames({ customer: 'customer-1' });
    const rows = octoberRows();
    const input = octoberInput({ ...rows, lines: [] });
    expect(() => buildStatement({ ...input, names })).toThrow('Statement customer name is missing');
  });

  it('still leaves the detail null for a line whose head is missing, and invents no name', () => {
    const input: StatementBuildInput = {
      ...octoberInput(),
      correctionLineDetails: new Map(),
    };
    const correction = buildStatement(input).rows.find((row) => row.kind === 'CORRECTION');
    expect(correction).toMatchObject({ lineId: null, serviceNameEn: null, customerName: null });
  });
});

describe('the builder appends the rows of a very large month', () => {
  it('builds one employee with more rows than a function call can take as arguments', () => {
    const rows = octoberRows();
    const tip = at(rows.tips, 0);
    const tips = Array.from({ length: 150_000 }, (_, index) => ({
      ...tip,
      sessionId: `session-${index}`,
    }));
    const input = octoberInput({
      ...rows,
      lines: [],
      sales: [],
      corrections: [],
      carries: [],
      tips,
    });
    const built = buildStatement(input);
    const mine = built.rows.filter((row) => row.employeeId === SARA && row.kind === 'TIP_CARD');
    expect(mine).toHaveLength(150_000);
    expect(mine.every((row) => row.sourceBranchId === SALMIYA)).toBe(true);
  });
});
