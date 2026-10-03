import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  id,
  templateListQuery,
  templateTerms,
  updateTemplateInput,
  archiveTemplateInput,
  applyTemplateInput,
  type TemplateTerms,
  type UpdateTemplateInput,
  type ApplyTemplateInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SCHEDULE_READ_ACCESS, type ScheduleReadAccess } from '../queries/schedule-week.query.ts';
import { listShiftTemplates } from '../queries/shift-templates.query.ts';
import { CreateShiftTemplateUseCase } from '../use-cases/create-shift-template/create-shift-template.usecase.ts';
import { UpdateShiftTemplateUseCase } from '../use-cases/update-shift-template/update-shift-template.usecase.ts';
import { ArchiveShiftTemplateUseCase } from '../use-cases/archive-shift-template/archive-shift-template.usecase.ts';
import { ApplyShiftTemplateUseCase } from '../use-cases/apply-shift-template/apply-shift-template.usecase.ts';
import { scheduleHttpResult } from './schedule-errors.ts';

@Controller('businesses/:businessId/shift-templates')
export class ShiftTemplatesController {
  constructor(
    @Inject(CreateShiftTemplateUseCase)
    private readonly createTemplate: CreateShiftTemplateUseCase | null,
    @Inject(UpdateShiftTemplateUseCase)
    private readonly updateTemplate: UpdateShiftTemplateUseCase | null,
    @Inject(ArchiveShiftTemplateUseCase)
    private readonly archiveTemplate: ArchiveShiftTemplateUseCase | null,
    @Inject(ApplyShiftTemplateUseCase)
    private readonly applyTemplate: ApplyShiftTemplateUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(SCHEDULE_READ_ACCESS) private readonly access: ScheduleReadAccess,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(templateListQuery)) query: { cursor?: string; limit: number },
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) => listShiftTemplates(tx, actor.companyId, actor.userId, businessId, query, this.access),
      { userId: actor.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
  @Post()
  @HttpCode(201)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(templateTerms)) input: TemplateTerms,
    @Req() request: FastifyRequest,
  ) {
    if (!this.createTemplate) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.createTemplate.execute({ ...actorOf(request), businessId, input }),
    );
  }
  @Patch(':templateId')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  update(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('templateId', new ZodValidationPipe(id)) templateId: string,
    @Body(new ZodValidationPipe(updateTemplateInput)) input: UpdateTemplateInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.updateTemplate) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.updateTemplate.execute({ ...actorOf(request), businessId, templateId, input }),
    );
  }
  @Post(':templateId/archive')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  archive(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('templateId', new ZodValidationPipe(id)) templateId: string,
    @Body(new ZodValidationPipe(archiveTemplateInput)) input: { expected_revision: number },
    @Req() request: FastifyRequest,
  ) {
    if (!this.archiveTemplate) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.archiveTemplate.execute({
        ...actorOf(request),
        businessId,
        templateId,
        expectedRevision: input.expected_revision,
      }),
    );
  }
  @Post(':templateId/apply')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  apply(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('templateId', new ZodValidationPipe(id)) templateId: string,
    @Body(new ZodValidationPipe(applyTemplateInput)) input: ApplyTemplateInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.applyTemplate) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.applyTemplate.execute({ ...actorOf(request), businessId, templateId, input }),
    );
  }
}
