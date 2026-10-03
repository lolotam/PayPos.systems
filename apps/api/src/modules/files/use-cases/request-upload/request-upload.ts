import type { RequestFileUpload } from '@pospay/contracts';
import { FileError, validateStoredPermission } from '../../domain/file.ts';
import type {
  Actor,
  FilePermissions,
  FileRepository,
  FileStorage,
  Clock,
  IdGenerator,
} from '../../ports/files.port.ts';

// يفتح الرفع بعد فحص صلاحية الإدارة والصلاحية التي ستحمي الملف لاحقاً.
export class RequestUpload {
  constructor(
    private readonly repository: FileRepository,
    private readonly storage: FileStorage,
    private readonly permissions: FilePermissions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, businessId: string, input: RequestFileUpload) {
    if (
      !(await this.permissions.allowed(actor, 'manage:files:business', businessId, null)) ||
      !(await this.permissions.allowed(
        actor,
        input.required_permission,
        businessId,
        input.branch_id ?? null,
      ))
    )
      throw new FileError('FORBIDDEN');
    validateStoredPermission(input.owner_module, input.required_permission);
    const id = this.ids.newId();
    const ticket = await this.storage.upload(
      actor,
      businessId,
      id,
      input.content_type,
      input.size_bytes,
    );
    await this.repository.create(actor, {
      id,
      businessId,
      branchId: input.branch_id ?? null,
      createdBy: actor.userId,
      requiredPermission: input.required_permission,
      stagingKey: ticket.key,
      contentType: input.content_type,
      sizeBytes: input.size_bytes,
      ownerModule: input.owner_module,
      ownerEntityId: input.owner_entity_id,
      createdAt: this.clock.now(),
    });
    return {
      id,
      upload_url: ticket.url,
      expires_in: 120 as const,
      headers: { 'content-type': input.content_type, 'content-length': String(input.size_bytes) },
    };
  }
}
