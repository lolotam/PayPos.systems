import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Controller, Get, Post, RequestMapping, RequestMethod } from '@nestjs/common';
import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { API_CONTROLLERS, createApp } from '../../../app.ts';
import { Public } from '../../../shared/public.decorator.ts';
import { Authenticated, Require } from '../../../shared/access.decorators.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import {
  type AuthenticatedWriteDeclaration,
  AUTHENTICATED_WRITES,
} from '../http/authenticated-writes.ts';
import { authenticatedWriteKeys } from '../http/route-coverage.ts';

// createApp refuses any route that does not declare exactly one access (ADR-0003 §6, plan T9a-2): these need no
// database, because the app never starts.
describe('routes without a declared access', () => {
  @Controller('probe/open')
  class Unguarded {
    @Get()
    open(): string {
      return 'open';
    }
  }

  it('an app with a route that is neither @Public, @Authenticated nor @Require refuses to start', async () => {
    await expect(
      createApp({ readiness: [] }, { controllers: [Unguarded], logger: createLogger('silent') }),
    ).rejects.toThrow(/Unguarded\.open/);
  });
});

describe('conflicting or inherited access declarations', () => {
  it('a public class, or @Authenticated beside @Require, cannot hide a permission — both refuse to start', async () => {
    @Public()
    @Controller('probe/public-class')
    class PublicClass {
      @Require('read:memberships:company')
      @Get()
      hidden(): string {
        return 'hidden';
      }
    }
    @Controller('probe/both')
    class Both {
      @Authenticated()
      @Require('read:memberships:company')
      @Get()
      hidden(): string {
        return 'hidden';
      }
    }
    for (const controller of [PublicClass, Both]) {
      await expect(
        createApp({ readiness: [] }, { controllers: [controller], logger: createLogger('silent') }),
      ).rejects.toThrow(/\.hidden \(conflicting\)/);
    }
  });
});

describe('inherited handlers', () => {
  it('an undecorated override hides the inherited route, as Nest does — no false conflict', async () => {
    class Base {
      @Require('read:memberships:company')
      @Get('hidden')
      hidden(): string {
        return 'base';
      }
    }
    @Public()
    @Controller('probe/override')
    class Override extends Base {
      override hidden(): string {
        return 'not a route';
      }
    }
    const started = await createApp(
      { readiness: [] },
      { controllers: [Override], logger: createLogger('silent') },
    );
    await started.close();
  });

  it('an inherited route with no declared access is caught too', async () => {
    class Base {
      @Get('inherited')
      inherited(): string {
        return 'open';
      }
    }
    @Controller('probe/child')
    class Child extends Base {}
    await expect(
      createApp({ readiness: [] }, { controllers: [Child], logger: createLogger('silent') }),
    ).rejects.toThrow(/Child\.inherited \(unguarded\)/);
  });
});

const silent = { logger: createLogger('silent') };
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const PERSONAL_GUARD = 'apps/api/src/shared/personal-session.guard.ts#personalSessionRequest';
const STAFF_GUARD = 'apps/api/src/shared/session.guard.ts##staff';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function codeWithoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

// A bare substring would accept a comment or a longer name (`verify` inside `verifyCashierPin`).
function symbolIsDeclared(source: string, symbol: string): boolean {
  if (symbol.length === 0) return false;
  const code = codeWithoutComments(source);
  const name = escapeRegExp(symbol);
  return new RegExp(`^\\s*(?:async\\s+)?${name}\\s*\\(`, 'm').test(code)
    ? true
    : [
        new RegExp(`(?:^|\\s)function\\s+${name}\\b`, 'm'),
        new RegExp(`(?:^|\\s)class\\s+${name}\\b`, 'm'),
        new RegExp(`(?:^|\\s)const\\s+${name}\\b`, 'm'),
      ].some((pattern) => pattern.test(code));
}

function mountedHandler(key: string): object {
  const dot = key.lastIndexOf('.');
  const controller = API_CONTROLLERS.find((item) => item.name === key.slice(0, dot));
  const handler = (controller?.prototype as Record<string, unknown> | undefined)?.[
    key.slice(dot + 1)
  ];
  if (typeof handler !== 'function') throw new Error(key);
  return handler;
}

function writeProbe(path: string): new () => { method(): string } {
  @Controller(path)
  class Probe {
    @Authenticated()
    @Post()
    method(): string {
      return 'write';
    }
  }
  return Probe;
}

describe('an undeclared @Authenticated write', () => {
  @Controller('probe/auth-write')
  class Probe {
    @Authenticated()
    @Post()
    method(): string {
      return 'write';
    }
  }

  it('refuses to start and names Probe.method', async () => {
    await expect(createApp({ readiness: [] }, { controllers: [Probe], ...silent })).rejects.toThrow(
      /Probe\.method/,
    );
  });
});

describe('an @Authenticated read', () => {
  @Controller('probe/auth-read')
  class Probe {
    @Authenticated()
    @Get()
    method(): string {
      return 'read';
    }
  }

  it('starts, because reads are outside the write list', async () => {
    const started = await createApp({ readiness: [] }, { controllers: [Probe], ...silent });
    await started.close();
  });
});

describe('a @Require write', () => {
  @Controller('probe/required-write')
  class RequiredWrite {
    @Require('read:memberships:company')
    @Post()
    method(): string {
      return 'required';
    }
  }

  it('starts without an allowlist entry', async () => {
    const started = await createApp({ readiness: [] }, { controllers: [RequiredWrite], ...silent });
    await started.close();
  });
});

describe('the mounted allowlist', () => {
  it('every allowlist key is a mounted @Authenticated write, and nothing mounted is missing', () => {
    const mounted = authenticatedWriteKeys(API_CONTROLLERS);
    expect(Object.keys(AUTHENTICATED_WRITES).sort()).toEqual([...mounted].sort());
  });

  it('every checkedIn symbol is declared in its file', () => {
    for (const entry of Object.values(AUTHENTICATED_WRITES)) {
      const splitAt = entry.checkedIn.indexOf('#');
      expect(splitAt).toBeGreaterThan(0);
      const file = entry.checkedIn.slice(0, splitAt);
      const symbol = entry.checkedIn.slice(splitAt + 1);
      const source = readFileSync(join(repoRoot, file), 'utf8');
      expect(symbolIsDeclared(source, symbol)).toBe(true);
    }
  });

  it('a personal or device route keeps the marker its guard reads', () => {
    for (const [key, entry] of Object.entries(AUTHENTICATED_WRITES)) {
      if (entry.access !== 'DEVICE_ONLY' && entry.access !== 'PERSONAL') continue;
      const handler = mountedHandler(key);
      const personal: unknown = Reflect.getMetadata(PERSONAL_ROUTE, handler);
      const staff: unknown = Reflect.getMetadata(STAFF_ROUTE, handler);
      const citesGuard = entry.checkedIn === PERSONAL_GUARD || entry.checkedIn === STAFF_GUARD;
      // A principal.kind check in the handler body has neither marker; removing a marker fails the guard cite.
      if (!citesGuard && personal === undefined && staff === undefined) continue;
      if (entry.access === 'DEVICE_ONLY') {
        expect(staff).toBe('device');
      } else if (personal !== undefined || entry.checkedIn === PERSONAL_GUARD) {
        expect(personal === true || personal === 'staff').toBe(true);
      } else {
        expect(staff).toBe('staff');
      }
    }
  });

  it('an unknown access kind is rejected by the type', () => {
    const declaration: AuthenticatedWriteDeclaration = {
      // @ts-expect-error unknown access is not RECORD_SCOPED, PERSONAL, or DEVICE_ONLY
      access: 'NOPE',
      checkedIn: 'apps/api/src/modules/identity/http/route-coverage.ts#assertEveryRouteGuarded',
    };
    expect(declaration.checkedIn).toContain('#');
  });
});

describe('checkedIn symbol declarations', () => {
  it('refuses an empty symbol', () => {
    expect(symbolIsDeclared('export function present() {}', '')).toBe(false);
  });

  it('refuses a symbol that appears only inside a comment', () => {
    const source = '// function ghost\n/* class ghost */\nconst other = 1;\n';
    expect(symbolIsDeclared(source, 'ghost')).toBe(false);
  });

  it('refuses a symbol that is only a substring of a longer identifier', () => {
    const source = 'export function verifyCashierPinInput() {}\n  async verifyCashierPin() {}\n';
    expect(symbolIsDeclared(source, 'verify')).toBe(false);
  });
});

describe('an authenticated WebDAV write', () => {
  @Controller('probe/proppatch')
  class Probe {
    @Authenticated()
    @RequestMapping({ path: '', method: RequestMethod.PROPPATCH })
    method(): string {
      return 'write';
    }
  }

  it('refuses to start, because only GET, HEAD, OPTIONS and SEARCH are reads', async () => {
    await expect(createApp({ readiness: [] }, { controllers: [Probe], ...silent })).rejects.toThrow(
      /Probe\.method/,
    );
  });
});

describe('two mounted controllers with one name', () => {
  it('refuses to start when either has an @Authenticated write', async () => {
    await expect(
      createApp(
        { readiness: [] },
        { controllers: [writeProbe('probe/same-a'), writeProbe('probe/same-b')], ...silent },
      ),
    ).rejects.toThrow(/unique controller name: Probe/);
  });
});
