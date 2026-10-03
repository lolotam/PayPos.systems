import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { id, requestFileUpload, fileDownloadByKey } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated, Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError, type ErrorCode } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import type { RequestUpload } from '../use-cases/request-upload/request-upload.ts';
import type { ConfirmUpload } from '../use-cases/confirm-upload/confirm-upload.ts';
import type { IssueDownload } from '../use-cases/issue-download/issue-download.ts';
import type { FileStatusQuery } from '../queries/file-status.query.ts';

export const FILE_COMMANDS = Symbol('FILE_COMMANDS');
export interface FileCommands {
  request: RequestUpload;
  confirm: ConfirmUpload;
  download: IssueDownload;
  status: FileStatusQuery;
}
const FILE_ERRORS: ReadonlySet<string> = new Set([
  'FORBIDDEN',
  'FILE_NOT_FOUND',
  'FILE_NOT_READY',
  'FILE_TYPE_INVALID',
  'FILE_SIZE_INVALID',
  'FILE_CONTENT_INVALID',
  'STORAGE_UNAVAILABLE',
]);
async function mapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && FILE_ERRORS.has(error.message))
      throw new ApiError(error.message as ErrorCode);
    throw error;
  }
}
function fileId(value: unknown): string {
  const parsed = id.safeParse(value);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  return parsed.data;
}

@Controller()
export class FilesController {
  constructor(@Inject(FILE_COMMANDS) private readonly commands: FileCommands | null) {}
  private configured(): FileCommands {
    if (this.commands === null) throw new ApiError('STORAGE_NOT_CONFIGURED');
    return this.commands;
  }
  @Post('businesses/:businessId/files/uploads')
  @Require('manage:files:business', { business: 'businessId' })
  async upload(
    @Param('businessId') businessId: string,
    @Body() input: unknown,
    @Req() request: FastifyRequest,
  ) {
    const commands = this.configured();
    const parsed = requestFileUpload.safeParse(input);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
    return mapped(() =>
      commands.request.execute(actorOf(request), fileId(businessId), parsed.data),
    );
  }
  @Post('files/:id/confirm')
  @HttpCode(202)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async confirm(@Param('id') id: string, @Req() request: FastifyRequest) {
    return mapped(() => this.configured().confirm.execute(actorOf(request), fileId(id)));
  }
  @Get('files/:id')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async status(@Param('id') id: string, @Req() request: FastifyRequest) {
    return mapped(() => this.configured().status.execute(actorOf(request), fileId(id)));
  }
  @Post('files/download')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async downloadByKey(@Body() input: unknown, @Req() request: FastifyRequest) {
    const commands = this.configured();
    const parsed = fileDownloadByKey.safeParse(input);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
    return mapped(() => commands.download.executeByKey(actorOf(request), parsed.data.storage_key));
  }
  @Post('files/:id/download')
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async download(@Param('id') id: string, @Req() request: FastifyRequest) {
    return mapped(() => this.configured().download.execute(actorOf(request), fileId(id)));
  }
}
