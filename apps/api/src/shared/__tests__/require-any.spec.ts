import 'reflect-metadata';

import { expect, it } from 'vitest';

import { REQUIRE_ACCESS, Require, RequireAny } from '../access.decorators.ts';

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
