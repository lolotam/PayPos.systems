import {
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  type ArgumentsHost,
} from '@nestjs/common';
import {
  commissionEstimatePeriod,
  commissionStatementExportRequest,
  id,
  type CommissionStatementExportRequest,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError, type ErrorCode } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';
import { bindVerifiedCompany } from '../../../shared/request-context.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  STATEMENT_EXPORT_STATUS_QUERY,
  type StatementExportStatusQuery,
} from '../queries/statement-export-status.query.ts';
import { StatementExportError } from '../use-cases/statement-export-error.ts';
import { CollectStatementExportUseCase } from '../use-cases/collect-statement-export/collect-statement-export.usecase.ts';
import { RequestStatementExportUseCase } from '../use-cases/request-statement-export/request-statement-export.usecase.ts';
import { commissionEstimateActor } from './commission-estimate.controller.ts';

const CODES: Readonly<Record<StatementExportError['code'], ErrorCode>> = {
  FORBIDDEN: 'FORBIDDEN',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  NOT_APPROVED: 'COMMISSION_STATEMENT_NOT_APPROVED',
  RATE_LIMITED: 'COMMISSION_STATEMENT_EXPORT_RATE_LIMITED',
  TRANSPORT_UNAVAILABLE: 'RENDERER_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  NOT_READY: 'DOCUMENT_NOT_READY',
  EXPIRED: 'DOCUMENT_EXPIRED',
};

// رفض التصدير مالوش ترجمة في المرشح العام، فبنترجمه هنا لكل مسارات التصدير.
@Catch(StatementExportError)
class StatementExportErrorFilter extends EnvelopeExceptionFilter {
  override catch(exception: StatementExportError, host: ArgumentsHost): void {
    super.catch(new ApiError(CODES[exception.code]), host);
  }
}

// اسم الملف ASCII، والنسخة المشفّرة بتوصل لنفس الاسم في المتصفحات القديمة (RFC 5987).
function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// الصلاحية (read:commissions:business بنطاق الفروع، CS-Q20) بتتحل جوّه معاملة كل مسار، مش بحارس على النشاط،
// لأن قارئ الفرع بس مفروض يعدّي؛ الإعلان في AUTHENTICATED_WRITES بيحدد مكان الفحص.
@Controller('businesses/:businessId/commission-statements/:period/exports')
@UseFilters(StatementExportErrorFilter)
export class CommissionStatementExportsController {
  constructor(
    @Inject(RequestStatementExportUseCase)
    private readonly request: RequestStatementExportUseCase | null,
    @Inject(CollectStatementExportUseCase)
    private readonly collect: CollectStatementExportUseCase | null,
    @Inject(STATEMENT_EXPORT_STATUS_QUERY)
    private readonly statusRead: StatementExportStatusQuery | null,
  ) {}

  @Post()
  @HttpCode(202)
  @Authenticated()
  async requestExport(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Body(new ZodValidationPipe(commissionStatementExportRequest))
    input: CommissionStatementExportRequest,
    @Req() request: FastifyRequest,
  ) {
    if (this.request === null) throw new ApiError('NOT_READY');
    const actor = commissionEstimateActor(request);
    const accepted = await this.request.execute({ ...actor, businessId, period, input });
    bindVerifiedCompany(actor.companyId);
    return accepted;
  }

  @Get(':renderId')
  @Authenticated()
  async status(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Param('renderId', new ZodValidationPipe(id.toLowerCase())) renderId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (this.statusRead === null) throw new ApiError('NOT_READY');
    reply.header('Cache-Control', 'no-store');
    const actor = commissionEstimateActor(request);
    const status = await this.statusRead({ ...actor, businessId, period }, renderId);
    bindVerifiedCompany(actor.companyId);
    return status;
  }

  @Post(':renderId/download')
  @HttpCode(200)
  @Authenticated()
  async download(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Param('renderId', new ZodValidationPipe(id.toLowerCase())) renderId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (this.collect === null) throw new ApiError('NOT_READY');
    const actor = commissionEstimateActor(request);
    const result = await this.collect.execute({ ...actor, businessId, period, renderId });
    bindVerifiedCompany(actor.companyId);
    reply.header('Content-Type', result.mimeType);
    reply.header('Content-Disposition', contentDisposition(result.filename));
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return Buffer.from(result.bytes);
  }
}
