import { Test } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { describe, expect, it } from 'vitest';

import { DATABASE } from '../../../shared/database.token.ts';

import {
  IMPORTED_REFUNDS_WIRING,
  ImportedRefundsController,
} from '../http/imported-refunds.controller.ts';
import { SETTINGS_WIRING } from '../http/settings.controller.ts';
import { settingsProviders } from '../settings.module.ts';
import { SetImportedRefunds } from '../use-cases/set-imported-refunds/set-imported-refunds.ts';

const ids = systemUuidV7();
type ValueProvider = { provide: unknown; useValue: unknown };
const wiringOf = (providers: Provider[], token: unknown) =>
  (providers as ValueProvider[]).find((provider) => provider.provide === token)?.useValue;

// قاعدة وهمية لكشف التسلك فقط: التسلك بيثبت إن المزود اتبني وحُلّ، والسلوك الحقيقي مغطى في IRS على القاعدة الحقيقية.
const unusedDatabase = {
  withTenant: async () => {
    throw new Error('wiring smoke never opens a transaction');
  },
} as unknown as TenantWrappers;

describe('the imported-refunds wiring availability', () => {
  it('the write wiring is DB-only: it resolves with a database and no Redis, and stays null without a database', () => {
    const dbOnly = settingsProviders(unusedDatabase, ids);
    const wiring = wiringOf(dbOnly, IMPORTED_REFUNDS_WIRING) as {
      set: unknown;
      read: unknown;
    };
    expect(wiring).not.toBeNull();
    expect(wiring.set).toBeInstanceOf(SetImportedRefunds);
    expect(typeof wiring.read).toBe('function');
    // أسلاك الإعدادات المعتمدة على Redis بتفضل زي ما هي: بدون Redis تفضل null، ومعاه تتحل.
    expect(wiringOf(dbOnly, SETTINGS_WIRING)).toBeNull();
    expect(
      wiringOf(settingsProviders(unusedDatabase, ids, {} as never), SETTINGS_WIRING),
    ).not.toBeNull();
    expect(wiringOf(settingsProviders(undefined, ids), IMPORTED_REFUNDS_WIRING)).toBeNull();
  });

  it('app-startup smoke: the thin controller resolves the DB-only wiring without Redis; no database keeps it null', async () => {
    const withDatabase = await Test.createTestingModule({
      controllers: [ImportedRefundsController],
      providers: [
        { provide: DATABASE, useValue: unusedDatabase },
        ...settingsProviders(unusedDatabase, ids),
      ],
    }).compile();
    const wiring = withDatabase.get(IMPORTED_REFUNDS_WIRING, { strict: false }) as {
      set: unknown;
      read: unknown;
    };
    expect(wiring).not.toBeNull();
    expect(wiring.set).toBeInstanceOf(SetImportedRefunds);
    expect(typeof wiring.read).toBe('function');
    expect(withDatabase.get(ImportedRefundsController, { strict: false })).toBeInstanceOf(
      ImportedRefundsController,
    );

    const withoutDatabase = await Test.createTestingModule({
      controllers: [ImportedRefundsController],
      providers: [
        { provide: DATABASE, useValue: null },
        ...settingsProviders(undefined, ids),
      ],
    }).compile();
    expect(withoutDatabase.get(IMPORTED_REFUNDS_WIRING, { strict: false })).toBeNull();
  });
});
