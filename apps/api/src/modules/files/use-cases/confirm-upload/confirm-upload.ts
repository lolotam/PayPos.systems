import { FileError } from '../../domain/file.ts';
import type {
  Actor,
  FileRepository,
  FilePermissions,
  FileQueue,
  Clock,
} from '../../ports/files.port.ts';

// يسلم الفحص للعامل دون انتظار قراءة الوثيقة أو فك الصورة في API.
export class ConfirmUpload {
  constructor(
    private readonly repository: FileRepository,
    private readonly permissions: FilePermissions,
    private readonly queue: FileQueue,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, id: string) {
    const file = await this.repository.find(actor, id);
    if (file === null) throw new FileError('FILE_NOT_FOUND');
    if (
      file.createdBy !== actor.userId ||
      !(await this.permissions.allowed(
        actor,
        'manage:files:business',
        file.businessId,
        file.branchId,
      ))
    )
      // ملف موجود مش مسموح لك بيه لازم يبان زي ملف مش موجود، عشان محدش يعرف وجود ملفات غيره.
      throw new FileError('FILE_NOT_FOUND');
    if (file.status === 'REJECTED') throw new FileError('FILE_NOT_READY');
    if (!(await this.repository.confirm(actor, id, this.clock.now())))
      throw new FileError('FILE_NOT_FOUND');
    await this.queue.enqueue(actor.companyId, id);
    return { id, status: 'QUEUED' as const };
  }
}
