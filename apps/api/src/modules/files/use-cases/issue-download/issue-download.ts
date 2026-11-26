import {
  effectiveReadPermission,
  FileError,
  readyKey,
  type FileRecord,
} from '../../domain/file.ts';
import type {
  Actor,
  FileRepository,
  FilePermissions,
  FileStorage,
  Clock,
} from '../../ports/files.port.ts';

// يصدر قدرة قصيرة بعد صلاحية القراءة الفعالة ويسجل كل قرار قبل إرجاعها.
export class IssueDownload {
  constructor(
    private readonly repository: FileRepository,
    private readonly permissions: FilePermissions,
    private readonly storage: FileStorage,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, id: string) {
    return this.issue(actor, await this.repository.find(actor, id));
  }
  async executeByKey(actor: Actor, key: string) {
    return this.issue(actor, await this.repository.findByKey(actor, key));
  }
  private async issue(actor: Actor, file: FileRecord | null) {
    if (file === null) throw new FileError('FILE_NOT_FOUND');
    const allowed = await this.permissions.allowed(
      actor,
      effectiveReadPermission(file.ownerModule, file.requiredPermission),
      file.businessId,
      file.branchId,
    );
    if (!allowed && !(await this.boundLogoAllowed(actor, file))) {
      await this.repository.audit(actor, file.id, 'DENY', this.clock.now());
      throw new FileError('FILE_NOT_FOUND');
    }
    const key = readyKey(file);
    const url = await this.storage.download(key, file.contentType);
    await this.repository.audit(actor, file.id, 'ALLOW', this.clock.now());
    return { download_url: url, expires_in: 60 as const };
  }
  /**
   * الشعار المربوط حالياً بينزل لأي عضو ساري بيغطي النشاط (TQ-1).
   * الملف لازم يكون هو الشعار المربوط نفسه؛ أي ملف إعدادات تاني يفضل مرفوض.
   */
  private async boundLogoAllowed(actor: Actor, file: FileRecord): Promise<boolean> {
    if (file.ownerModule !== 'settings') return false;
    if (!(await this.permissions.coversBusiness(actor, file.businessId))) return false;
    return this.repository.isBoundBusinessLogo(actor, file.businessId, file.id);
  }
}
