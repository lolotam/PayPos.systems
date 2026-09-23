import { Controller, Get } from '@nestjs/common';
import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../../app.ts';
import { Public } from '../../../shared/public.decorator.ts';
import { Authenticated, Require } from '../index.ts';

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
