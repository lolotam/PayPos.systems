import 'reflect-metadata';

import { expect, it } from 'vitest';

import { REQUIRE_ACCESS, Require, RequireAll, RequireAny } from '../access.decorators.ts';

const metadata = (handler: object) => Reflect.getMetadata(REQUIRE_ACCESS, handler);

// The decorator is applied to a real method, so the throw happens where a route would declare it.
const decorate = (decorator: MethodDecorator): object => {
  class Probe {
    @decorator
    handler(): void {}
  }
  return Probe.prototype.handler;
};

it('Require stores the one permission it checks', () => {
  class Probe {
    @Require('read:settings:business', { business: 'businessId' })
    handler(): void {}
  }
  expect(metadata(Probe.prototype.handler)).toEqual({
    permissions: ['read:settings:business'],
    target: { business: 'businessId' },
    mode: 'any',
  });
});

it('RequireAny stores every listed permission and the target they share', () => {
  class Probe {
    @RequireAny(['read:settings:business', 'manage:settings:business'], { business: 'businessId' })
    handler(): void {}
  }
  expect(metadata(Probe.prototype.handler)).toEqual({
    permissions: ['read:settings:business', 'manage:settings:business'],
    target: { business: 'businessId' },
    mode: 'any',
  });
});

it('an empty list, mixed scopes, and a target the scope does not name fail at decoration time', () => {
  expect(() => decorate(RequireAny([]))).toThrow(TypeError);
  expect(() => decorate(RequireAny(['read:settings:business', 'read:attendance:branch']))).toThrow(
    TypeError,
  );
  expect(() =>
    decorate(
      RequireAny(['read:settings:business', 'manage:settings:business'], { branch: 'branchId' }),
    ),
  ).toThrow(TypeError);
});

it('a single permission still throws the message @Require always threw', () => {
  expect(() => decorate(Require('read:settings:business', { branch: 'branchId' }))).toThrow(
    "@Require('read:settings:business') needs exactly the target its scope names",
  );
});

it('RequireAll stores every listed permission, the target they share and the all mode', () => {
  class Probe {
    @RequireAll(['read:settings:business', 'manage:settings:business'], { business: 'businessId' })
    handler(): void {}
  }
  expect(metadata(Probe.prototype.handler)).toEqual({
    permissions: ['read:settings:business', 'manage:settings:business'],
    target: { business: 'businessId' },
    mode: 'all',
  });
});

it('RequireAll names itself in every failure message', () => {
  const emptyList = () => decorate(RequireAll([]));
  const mixedScopes = () =>
    decorate(RequireAll(['read:settings:business', 'read:attendance:branch']));
  const targetOutOfScope = () =>
    decorate(
      RequireAll(['read:settings:business', 'manage:settings:business'], { branch: 'branchId' }),
    );

  expect(emptyList).toThrow(TypeError);
  expect(emptyList).toThrow('@RequireAll() needs at least one permission');
  expect(mixedScopes).toThrow(TypeError);
  expect(mixedScopes).toThrow('@RequireAll() needs one scope for every permission');
  expect(targetOutOfScope).toThrow(TypeError);
  expect(targetOutOfScope).toThrow('@RequireAll() needs exactly the target its scope names');
});

it('RequireAll keeps its own label for a single permission, where RequireAny borrows the @Require one', () => {
  expect(() => decorate(RequireAll(['read:settings:business'], { branch: 'branchId' }))).toThrow(
    '@RequireAll() needs exactly the target its scope names',
  );
  expect(() => decorate(RequireAny(['read:settings:business'], { branch: 'branchId' }))).toThrow(
    "@Require('read:settings:business') needs exactly the target its scope names",
  );
});

it('a single-permission RequireAll and a single-permission Require differ only in the mode', () => {
  class AllProbe {
    @RequireAll(['read:settings:business'], { business: 'businessId' })
    handler(): void {}
  }
  class AnyProbe {
    @Require('read:settings:business', { business: 'businessId' })
    handler(): void {}
  }
  const all = metadata(AllProbe.prototype.handler);
  const any = metadata(AnyProbe.prototype.handler);
  expect(all).toEqual({ ...any, mode: 'all' });
  expect(any.mode).toBe('any');
});
