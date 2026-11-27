import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDeviceRole,
  connectEmployee,
  NativeShellDatabase,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  saveDeviceRole,
} from './device-role';

// القاعدة الحقيقية IndexedDB، فبنمسكها بقاعدة في الذاكرة: جدولان بخريطة لكل واحد،
// ومعاملة واحدة بترجّع السطور لو الكتابة فشلت.
const state = vi.hoisted(() => ({
  versions: [] as { version: number; stores: Record<string, string> }[],
  rows: new Map<string, Map<string, unknown>>(),
  failing: new Set<string>(),
}));

vi.mock('dexie', () => {
  class MemoryDexie {
    constructor(public name: string) {}
    version(number: number) {
      return {
        stores: (schema: Record<string, string>) => {
          state.versions.push({ version: number, stores: { ...schema } });
          for (const table of Object.keys(schema)) {
            if (!state.rows.has(table)) state.rows.set(table, new Map());
            const rows = state.rows.get(table) as Map<string, unknown>;
            (this as unknown as Record<string, unknown>)[table] = {
              rows,
              get: async (id: string) => rows.get(id),
              put: async (row: { id: string }) => {
                if (state.failing.has(table)) throw new Error('SYNTHETIC_WRITE_FAILURE');
                rows.set(row.id, row);
                return row.id;
              },
              delete: async (id: string) => {
                rows.delete(id);
              },
            };
          }
          return this;
        },
      };
    }
    transaction(_mode: 'rw', ...args: unknown[]) {
      const scope = args[args.length - 1] as () => Promise<unknown>;
      const tables = args.slice(0, -1) as { rows: Map<string, unknown> }[];
      const snapshots = tables.map((table) => new Map(table.rows));
      return (async () => {
        try {
          return await scope();
        } catch (error) {
          tables.forEach((table, index) => {
            table.rows.clear();
            for (const [key, value] of snapshots[index] ?? []) table.rows.set(key, value);
          });
          throw error;
        }
      })();
    }
  }
  return { default: MemoryDexie };
});

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';

/** سطور الجدول المخزنة في الذاكرة. */
function rows(table: string): Map<string, unknown> {
  const stored = state.rows.get(table);
  if (stored === undefined) throw new Error('SYNTHETIC_TABLE_MISSING');
  return stored;
}

beforeEach(() => {
  for (const stored of state.rows.values()) stored.clear();
  state.failing.clear();
});

describe('the shell store schema', () => {
  it('declares the role table first and the remembered business beside it', () => {
    const before = state.versions.length;
    const db = new NativeShellDatabase();

    expect(db.name).toBe('pospay-native-shell');
    expect(state.versions.slice(before)).toEqual([
      { version: 1, stores: { role: 'id' } },
      { version: 2, stores: { role: 'id', business: 'id' } },
    ]);
  });

  it('keeps the role of a store upgraded from the first version and starts with no business', async () => {
    await rows('role').set('current', { id: 'current', role: 'employee' });

    await expect(readDeviceRole()).resolves.toBe('employee');
    await expect(readRememberedBusiness()).resolves.toBeNull();
  });
});

describe('connecting the employee', () => {
  it('writes the role and the remembered business together', async () => {
    await connectEmployee({ company_id: COMPANY, business_id: BUSINESS });

    expect(rows('role').get('current')).toEqual({ id: 'current', role: 'employee' });
    expect(rows('business').get('current')).toEqual({
      id: 'current',
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('leaves no row behind when the business cannot be written', async () => {
    state.failing.add('business');

    await expect(connectEmployee({ company_id: COMPANY, business_id: BUSINESS })).rejects.toThrow(
      'SYNTHETIC_WRITE_FAILURE',
    );
    expect(rows('role').size).toBe(0);
    expect(rows('business').size).toBe(0);
  });
});

describe('the remembered business', () => {
  it('ignores a stored row that is not a valid workspace', async () => {
    await rows('business').set('current', {
      id: 'current',
      company_id: 'not-a-uuid',
      business_id: 'not-a-uuid',
    });

    await expect(readRememberedBusiness()).resolves.toBeNull();
  });

  it('answers the stored workspace when it is valid', async () => {
    await rows('business').set('current', {
      id: 'current',
      company_id: COMPANY,
      business_id: BUSINESS,
    });

    await expect(readRememberedBusiness()).resolves.toEqual({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('saves and clears the role without disturbing the remembered business', async () => {
    await saveDeviceRole('counter');
    await rememberBusiness({ company_id: COMPANY, business_id: BUSINESS });

    await expect(readDeviceRole()).resolves.toBe('counter');
    await clearDeviceRole();

    await expect(readDeviceRole()).resolves.toBeNull();
    await expect(readRememberedBusiness()).resolves.toEqual({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });
});
