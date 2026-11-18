import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { Require } from '../../../shared/access.decorators.ts';
import { AccessGuard } from '../http/access.guard.ts';

class Picker {
  @Require('sell:packages:branch', { branch: 'branchId' })
  list() {}
}
const context = {
  getHandler: () => Picker.prototype.list,
  getClass: () => Picker,
  switchToHttp: () => ({ getRequest: () => ({ principal: { kind: 'device', userId: null } }) }),
} as unknown as ExecutionContext;

it('already refuses device principals in the global access guard', async () => {
  const execute = vi.fn();
  const authorize = { execute } as unknown as ConstructorParameters<typeof AccessGuard>[1];
  await expect(new AccessGuard(new Reflector(), authorize).canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(execute).not.toHaveBeenCalled();
});

