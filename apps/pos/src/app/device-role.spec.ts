import Dexie, { type Table } from 'dexie';
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

// قاعدة في الذاكرة بتفصل الجداول حسب إصدار القاعدة اللي اتفتح، وترقّي المخزن المشترك من v1 لـ v2
// عشان نختبر إن الترقية بتحفظ الدور الموجود وتضيف جدول النشاط مع الرجوع لو المعاملة فشلت.
const state = vi.hoisted(() => ({
  versions: [] as { version: number; stores: Record<string, string> }[],
  databases: new Map<string, Map<string, Map<string, unknown>>>(),
  failing: new Set<string>(),
  activeTransactionTables: null as Set<string> | null,
}));

function assertInTransactionScope(dbName: string, table: string): void {
  if (
    state.activeTransactionTables !== null &&
    !state.activeTransactionTables.has(`${dbName}:${table}`)
  ) {
    throw new Error('SYNTHETIC_OUTSIDE_TRANSACTION_SCOPE');
  }
}

function createTableHandle(dbName: string, table: string) {
  return {
    dbName,
    tableName: table,
    get: async (id: string) => {
      assertInTransactionScope(dbName, table);
      return storeRows(dbName, table).get(id);
    },
    put: async (row: { id: string }) => {
      assertInTransactionScope(dbName, table);
      if (state.failing.has(table)) throw new Error('SYNTHETIC_WRITE_FAILURE');
      storeRows(dbName, table).set(row.id, row);
      return row.id;
    },
    delete: async (id: string) => {
      assertInTransactionScope(dbName, table);
      storeRows(dbName, table).delete(id);
    },
  };
}

/** جدول في الذاكرة مرتبط بمخزن القاعدة الحالي (يفشل لو الجدول مش متعرف في القاعدة لسه). */
function storeRows(dbName: string, table: string): Map<string, unknown> {
  const rows = state.databases.get(dbName)?.get(table);
  if (rows === undefined) throw new Error('SYNTHETIC_TABLE_MISSING');
  return rows;
}

vi.mock('dexie', () => {
  class MemoryDexie {
    constructor(public name: string) {}
    version(number: number) {
      return {
        stores: (schema: Record<string, string>) => {
          state.versions.push({ version: number, stores: { ...schema } });
          let stores = state.databases.get(this.name);
          if (stores === undefined) {
            stores = new Map();
            state.databases.set(this.name, stores);
          }
          for (const table of Object.keys(schema)) {
            if (!stores.has(table)) stores.set(table, new Map());
            (this as unknown as Record<string, unknown>)[table] = createTableHandle(
              this.name,
              table,
            );
          }
          return this;
        },
      };
    }
    transaction(_mode: 'rw', ...args: unknown[]) {
      const scope = args[args.length - 1] as () => Promise<unknown>;
      const tables = args.slice(0, -1) as { dbName: string; tableName: string }[];
      const allowed = new Set(tables.map((t) => `${t.dbName}:${t.tableName}`));
      const snapshots = tables.map((t) => new Map(storeRows(t.dbName, t.tableName)));
      return (async () => {
        const previous = state.activeTransactionTables;
        state.activeTransactionTables = allowed;
        try {
          return await scope();
        } catch (error) {
          tables.forEach((t, index) => {
            const target = storeRows(t.dbName, t.tableName);
            target.clear();
            for (const [key, value] of snapshots[index] ?? []) target.set(key, value);
          });
          throw error;
        } finally {
          state.activeTransactionTables = previous;
        }
      })();
    }
  }
  return { default: MemoryDexie };
});

class LegacyShellV1Database extends Dexie {
  role!: Table<{ id: 'current'; role: string }, 'current'>;
  business?: Table<unknown, 'current'>;

  constructor() {
    super('pospay-native-shell');
    this.version(1).stores({ role: 'id' });
  }
}

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const OTHER_BUSINESS = '00000000-0000-4000-8000-000000000003';

beforeEach(() => {
  state.databases.delete('pospay-native-shell');
  new NativeShellDatabase();
  state.failing.clear();
  state.activeTransactionTables = null;
});

describe('the shell store schema (MemoryDexie contract)', () => {
  it('declares the role table first and the remembered business beside it', () => {
    const before = state.versions.length;
    const db = new NativeShellDatabase();

    expect(db.name).toBe('pospay-native-shell');
    expect(state.versions.slice(before)).toEqual([
      { version: 1, stores: { role: 'id' } },
      { version: 2, stores: { role: 'id', business: 'id' } },
    ]);
  });

  it('upgrades a v1 database preserving its stored role and adding an empty business store', async () => {
    state.databases.delete('pospay-native-shell');
    const v1 = new LegacyShellV1Database();
    expect(v1.business).toBeUndefined();
    await v1.role.put({ id: 'current', role: 'employee' });
    await expect(readRememberedBusiness()).rejects.toThrow('SYNTHETIC_TABLE_MISSING');

    new NativeShellDatabase();

    await expect(readDeviceRole()).resolves.toBe('employee');
    await expect(readRememberedBusiness()).resolves.toBeNull();
  });
});

describe('connecting the employee', () => {
  it('writes the role and the remembered business together', async () => {
    await connectEmployee({ company_id: COMPANY, business_id: BUSINESS });

    await expect(readDeviceRole()).resolves.toBe('employee');
    await expect(readRememberedBusiness()).resolves.toEqual({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('leaves no row behind when the business write fails in a fresh store', async () => {
    state.failing.add('business');

    await expect(connectEmployee({ company_id: COMPANY, business_id: BUSINESS })).rejects.toThrow(
      'SYNTHETIC_WRITE_FAILURE',
    );
    await expect(readDeviceRole()).resolves.toBeNull();
    await expect(readRememberedBusiness()).resolves.toBeNull();
  });

  it('restores prior role and business rows when the business write fails', async () => {
    await saveDeviceRole('counter');
    await rememberBusiness({ company_id: COMPANY, business_id: BUSINESS });
    state.failing.add('business');

    await expect(
      connectEmployee({ company_id: COMPANY, business_id: OTHER_BUSINESS }),
    ).rejects.toThrow('SYNTHETIC_WRITE_FAILURE');
    await expect(readDeviceRole()).resolves.toBe('counter');
    await expect(readRememberedBusiness()).resolves.toEqual({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });
});

describe('the remembered business', () => {
  it('ignores a stored row that is not a valid workspace', async () => {
    storeRows('pospay-native-shell', 'business').set('current', {
      id: 'current',
      company_id: 'not-a-uuid',
      business_id: 'not-a-uuid',
    });

    await expect(readRememberedBusiness()).resolves.toBeNull();
  });

  it('answers the stored workspace when it is valid', async () => {
    await rememberBusiness({ company_id: COMPANY, business_id: BUSINESS });

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

  it('rejects writes to tables outside the declared transaction scope', async () => {
    const db = new NativeShellDatabase();
    await expect(
      db.transaction('rw', db.role, async () => {
        await db.business.put({ id: 'current', company_id: COMPANY, business_id: BUSINESS });
      }),
    ).rejects.toThrow('SYNTHETIC_OUTSIDE_TRANSACTION_SCOPE');
  });
});
