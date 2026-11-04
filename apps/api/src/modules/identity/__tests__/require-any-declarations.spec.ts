import 'reflect-metadata';
import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import type { FastifyRequest } from 'fastify';
import { expect, it, vi } from 'vitest';

import { Authenticated, RequireAny, RequiresFeature } from '../../../shared/access.decorators.ts';
import { Public } from '../../../shared/public.decorator.ts';
import { AccessGuard, FeatureGuard } from '../http/access.guard.ts';
import { assertEveryRouteGuarded } from '../http/route-coverage.ts';
import type { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import type { CheckFeature } from '../use-cases/check-feature/check-feature.ts';

@Controller('probe')
class Probe {
  @RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], {
    branch: 'branchId',
  })
  @RequiresFeature('orders')
  @Get()
  any(): void {}

  @Authenticated()
  @RequiresFeature('orders')
  @Get('session')
  session(): void {}
}

function context(request: FastifyRequest, handler = Probe.prototype.any): ExecutionContext {
  return new ExecutionContextHost([request], Probe, handler);
}
function request(): FastifyRequest {
  return {
    headers: { 'x-company-id': 'company' },
    params: { branchId: 'branch' },
    principal: { userId: 'user', companyId: 'company', grants: [] },
  } as unknown as FastifyRequest;
}
function guards(feature?: { flag: string; enabled: boolean }) {
  const execute = vi.fn().mockResolvedValue({
    companyId: 'company',
    memberships: [],
    grants: [],
    ...(feature === undefined ? {} : { feature }),
  });
  const fallback = vi.fn().mockResolvedValue(false);
  const reflector = new Reflector();
  return {
    access: new AccessGuard(reflector, { execute } as unknown as AuthorizeRequest),
    feature: new FeatureGuard(reflector, { execute: fallback } as unknown as CheckFeature),
    execute,
    fallback,
  };
}

it('startup accepts RequireAny and refuses Public/Authenticated conflicts', () => {
  expect(() => assertEveryRouteGuarded([Probe])).not.toThrow();
  @Public()
  class PublicProbe extends Probe {}
  class Both {
    @Authenticated()
    @RequireAny(['record:service-sessions:branch'], { branch: 'branchId' })
    @Get()
    any(): void {}
  }
  for (const controller of [PublicProbe, Both]) {
    expect(() => assertEveryRouteGuarded([controller])).toThrow(/conflicting/);
  }
});
it('a device without a user is refused before invoking the authorizer', async () => {
  const g = guards();
  const req = request();
  if (req.principal === undefined) throw new Error('Missing synthetic principal');
  req.principal = { ...req.principal, userId: null };
  await expect(g.access.canActivate(context(req))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(g.execute).not.toHaveBeenCalled();
});
it.each([true, false])(
  'matching server-created feature %s is consumed without another read',
  async (enabled) => {
    const g = guards({ flag: 'orders', enabled });
    const ctx = context(request());
    await g.access.canActivate(ctx);
    expect(g.execute).toHaveBeenCalledWith(expect.objectContaining({ featureFlag: 'orders' }));
    if (enabled) expect(await g.feature.canActivate(ctx)).toBe(true);
    else
      await expect(g.feature.canActivate(ctx)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(g.fallback).not.toHaveBeenCalled();
  },
);
it.each(['missing', 'company', 'flag', 'new-request'] as const)(
  '%s feature result uses the existing fallback',
  async (mismatch) => {
    const g = guards(
      mismatch === 'missing'
        ? undefined
        : { flag: mismatch === 'flag' ? 'staff' : 'orders', enabled: true },
    );
    const req = request();
    await g.access.canActivate(context(req));
    if (req.principal === undefined) throw new Error('Missing synthetic principal');
    if (mismatch === 'company') req.principal = { ...req.principal, companyId: 'other' };
    const next = mismatch === 'new-request' ? request() : req;
    await expect(g.feature.canActivate(context(next))).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(g.fallback).toHaveBeenCalledOnce();
  },
);
it('a non-permission route ignores client feature claims and keeps fallback/null-dependency refusal', async () => {
  const g = guards();
  const req = request();
  req.headers['x-feature-enabled'] = 'true';
  req.body = { flag: 'orders', enabled: true };
  const ctx = context(req, Probe.prototype.session);
  await g.access.canActivate(ctx);
  expect(g.execute).not.toHaveBeenCalled();
  await expect(g.feature.canActivate(ctx)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(g.fallback).toHaveBeenCalledOnce();
  await expect(new FeatureGuard(new Reflector(), null).canActivate(ctx)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  delete req.principal;
  await expect(g.feature.canActivate(ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
