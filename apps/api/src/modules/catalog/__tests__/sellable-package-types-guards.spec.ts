import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { SessionAdminGuard } from '../../../shared/session-admin.guard.ts';
import { SellablePackageTypesController } from '../http/sellable-package-types.controller.ts';

const context = {
  getHandler: () => SellablePackageTypesController.prototype.list,
  getClass: () => SellablePackageTypesController,
  switchToHttp: () => ({ getRequest: () => ({ principal: { kind: 'device', userId: null } }) }),
} as unknown as ExecutionContext;

it('explicitly declares the same user-only guard as package sales', () => {
  expect(Reflect.getMetadata('__guards__', SellablePackageTypesController.prototype.list) ?? []).toContain(SessionAdminGuard);
});

it('the explicit user-only guard refuses a device principal', () => {
  expect(() => new SessionAdminGuard().canActivate(context)).toThrow(ApiError);
});
