import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Controller, Get, Post } from '@nestjs/common';
import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { API_CONTROLLERS, createApp } from '../../../app.ts';
import { Public } from '../../../shared/public.decorator.ts';
import { Authenticated, Require } from '../../../shared/access.decorators.ts';
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
    await expect(
      createApp({ readiness: [] }, { controllers: [Probe], ...silent }),
    ).rejects.toThrow(/Probe\.method/);
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
    const started = await createApp(
      { readiness: [] },
      { controllers: [RequiredWrite], ...silent },
    );
    await started.close();
  });
});

describe('the mounted allowlist', () => {
  it('every allowlist key is a mounted @Authenticated write, and nothing mounted is missing', () => {
    const mounted = authenticatedWriteKeys(API_CONTROLLERS);
    expect(Object.keys(AUTHENTICATED_WRITES).sort()).toEqual([...mounted].sort());
  });

  it('every checkedIn file contains its symbol', () => {
    for (const entry of Object.values(AUTHENTICATED_WRITES)) {
      const splitAt = entry.checkedIn.indexOf('#');
      const file = entry.checkedIn.slice(0, splitAt);
      const symbol = entry.checkedIn.slice(splitAt + 1);
      expect(readFileSync(join(repoRoot, file), 'utf8')).toContain(symbol);
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
