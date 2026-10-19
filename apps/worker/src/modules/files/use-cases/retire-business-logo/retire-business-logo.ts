import type { Tx } from '@pospay/db';

import { shouldRetireUnreferencedLogo } from '../../domain/retention.ts';
import type { LogoReference } from '../../ports/logo-reference.port.ts';
import type { LogoRetirementStore } from '../../ports/logo-retirement.port.ts';
import type { Clock } from '../../ports/verification.port.ts';

// يسلّم ملف الشعار السابق للحذف بعد التأكد أن النشاط لم يعد يشير إليه.
export class RetireBusinessLogo {
  constructor(
    private readonly files: LogoRetirementStore,
    private readonly logos: LogoReference,
    private readonly clock: Clock,
  ) {}
  async execute(tx: Tx, companyId: string, businessId: string, fileId: string): Promise<void> {
    const stillReferenced = await this.logos.holds(tx, companyId, businessId, fileId);
    if (!shouldRetireUnreferencedLogo(stillReferenced)) return;
    await this.files.markIfFree(tx, companyId, businessId, fileId, this.clock.now());
  }
}
