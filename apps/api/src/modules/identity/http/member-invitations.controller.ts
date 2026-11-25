import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  id,
  inviteMemberInput,
  pageQuery,
  type InviteMemberInput,
  type PageQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listMemberInvitations } from '../queries/member-invitations.query.ts';
import { InviteMember } from '../use-cases/invite-member/invite-member.ts';
import { ReissueMemberInvitation } from '../use-cases/reissue-member-invitation/reissue-member-invitation.ts';

/** بيقول إن العضو حط كلمة مروره — القارئ من جداول الهوية، مربوط في identity.module.ts. */
export type MemberPasswordState = (userIds: readonly string[]) => Promise<ReadonlySet<string>>;

/** رمز الحقن لقراءة حالة كلمة المرور من جداول الهوية. */
export const MEMBER_PASSWORD_STATE = Symbol('MEMBER_PASSWORD_STATE');

@Controller('memberships/invitations')
export class MemberInvitationsController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(InviteMember) private readonly invite: InviteMember | null,
    @Inject(ReissueMemberInvitation) private readonly reissue: ReissueMemberInvitation | null,
    @Inject(MEMBER_PASSWORD_STATE) private readonly passwordState: MemberPasswordState | null,
  ) {}

  @Post()
  @Require('manage:memberships:company')
  async inviteMember(
    @Body(new ZodValidationPipe(inviteMemberInput)) input: InviteMemberInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.invite === null) throw new ApiError('NOT_READY');
    return this.invite.execute({ actor: actorOf(request), input });
  }

  @Post(':invitationId/link')
  @HttpCode(200)
  @Require('manage:memberships:company')
  async reissueLink(
    @Param('invitationId', new ZodValidationPipe(id)) invitationId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.reissue === null) throw new ApiError('NOT_READY');
    return this.reissue.execute({ actor: actorOf(request), invitationId });
  }

  @Get()
  @Require('manage:memberships:company')
  async list(
    // الـ cursor هنا معرّف دعوة (uuid): أي نص تاني بيرفض في الـ validation قبل أي SQL، مش 500.
    @Query(new ZodValidationPipe(pageQuery.extend({ cursor: id.optional() }))) page: PageQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.passwordState === null) throw new ApiError('NOT_READY');
    return listMemberInvitations(this.database, actorOf(request), page, this.passwordState);
  }
}
