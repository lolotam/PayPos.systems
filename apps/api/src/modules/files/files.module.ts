import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { optionalStorage, type ObjectStorage, type UploadPolicy } from '@pospay/storage';
import type { Redis } from 'ioredis';
import { REQUEST_AUTHORIZER, type RequestAuthorizer } from '../../shared/request-authorizer.ts';
import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { FILE_COMMANDS, FilesController } from './http/files.controller.ts';
import { createFileRepository } from './persistence/file-repository.ts';
import { filePermissions } from './persistence/permissions.adapter.ts';
import { fileStorage } from './persistence/storage.adapter.ts';
import { createFileQueue } from './persistence/queue.adapter.ts';
import { RequestUpload } from './use-cases/request-upload/request-upload.ts';
import { ConfirmUpload } from './use-cases/confirm-upload/confirm-upload.ts';
import { IssueDownload } from './use-cases/issue-download/issue-download.ts';
import { FileStatusQuery } from './queries/file-status.query.ts';
import type { FileQueue } from './ports/files.port.ts';

export interface FilesRuntime {
  storage: ObjectStorage;
  policy: UploadPolicy;
  queue: FileQueue;
}
export const filesControllers = [FilesController];

export function filesRuntime(env: Readonly<Record<string, string | undefined>>, redis: Redis) {
  const capability = optionalStorage(env);
  if (capability === null) return null;
  const transport = createFileQueue(redis);
  return {
    ...capability,
    queue: transport.port,
    close: async () => {
      await transport.close();
      capability.storage.close();
    },
  };
}

export function filesProviders(
  db: TenantWrappers | undefined,
  ids: IdGenerator,
  runtime?: FilesRuntime | null,
): Provider[] {
  return [
    SelectedCompanyGuard,
    {
      provide: FILE_COMMANDS,
      inject: [REQUEST_AUTHORIZER],
      useFactory: (authorizer: RequestAuthorizer | null) => {
        if (db === undefined || runtime == null || authorizer === null) return null;
        const repository = createFileRepository(db, ids),
          permissions = filePermissions(authorizer);
        const storage = fileStorage(runtime.storage, runtime.policy),
          clock = { now: () => new Date() };
        return {
          request: new RequestUpload(repository, storage, permissions, ids, clock),
          confirm: new ConfirmUpload(repository, permissions, runtime.queue, clock),
          download: new IssueDownload(repository, permissions, storage, clock),
          status: new FileStatusQuery(db, authorizer),
        };
      },
    },
  ];
}
