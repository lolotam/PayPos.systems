import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';

// جهاز الكاشير مش عضو مستخدم. تعديته هنا يخلي الرد false واحد، من غير 403 يميّز الجهاز عن باقي الرفض.
@Injectable()
export class IdentityCapabilityCompanyGuard implements CanActivate {
  constructor(@Inject(SelectedCompanyGuard) private readonly selected: SelectedCompanyGuard) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.principal?.kind === 'device') return true;
    return this.selected.canActivate(context);
  }
}
