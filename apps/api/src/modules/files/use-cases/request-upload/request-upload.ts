import type { RequestFileUpload } from '@pospay/contracts';
import { FileError, uploadAuthority, validateStoredPermission } from '../../domain/file.ts';
import type {
  Actor,
  FilePermissions,
  FileRepository,
  FileStorage,
  Clock,
  IdGenerator,
} from '../../ports/files.port.ts';

// يفتح الرفع: شعار النشاط بصلاحية هوية النشاط وحدها (BI-Q5)، وباقي الملفات بإدارة الملفات والصلاحية المحفوظة.
export class RequestUpload {
  constructor(
    private readonly repository: FileRepository,
    private readonly storage: FileStorage,
    private readonly permissions: FilePermissions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, businessId: string, input: RequestFileUpload) {
    const branchId = input.branch_id ?? null;
    if (!(await this.permitted(actor, businessId, branchId, input)))
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

  private async permitted(
    actor: Actor,
    businessId: string,
    branchId: string | null,
    input: RequestFileUpload,
  ): Promise<boolean> {
    const authority = uploadAuthority(input.owner_module);
    if (!(await this.permissions.allowed(actor, authority, businessId, branchId))) return false;
    // الصلاحية المحفوظة لملف الإعدادات هي نفس بوابة الرفع؛ فحصها التاني بيتم في validateStoredPermission.
    if (input.owner_module === 'settings') return true;
    return this.permissions.allowed(actor, input.required_permission, businessId, branchId);
  }
}
