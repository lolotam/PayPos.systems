import type { TenantWrappers } from '@pospay/db';
import { startPackageSaleRecoveryProcessor } from './jobs/package-sale-recovery.processor.ts';
import { startPackageImportRecoveryProcessor } from './jobs/package-import-recovery.processor.ts';
import { packageSaleRecoveryTransactions } from './persistence/package-sale-recovery.transactions.ts';
import { packageImportRecoveryTransactions } from './persistence/package-import-recovery.transactions.ts';
import { RecoverPackageSales } from './use-cases/recover-package-sales/recover-package-sales.ts';
import { RecoverPackageImports } from './use-cases/recover-package-imports/recover-package-imports.ts';
import type { PackageSaleClock } from './ports/package-sale.port.ts';
import type { PackageCommitClock } from './ports/package-import-commit.port.ts';

// بيانات المسح قصيرة ومفهرسة؛ لا تستخدم ميزانية المعاملة المالية أبدًا.
const PACKAGE_RECOVERY_SCAN_TIMEOUT_MS = 5_000;

/** هدف الاستعادة كما يراه مسح الاكتشاف الدوري: فحص الطلب المعلق وتسجيل الجدولة على Redis (#1035). */
export interface PackageRecoveryTarget {
  readonly name: string;
  readonly hasPending: (companyId: string) => Promise<boolean>;
  readonly register: (companyId: string) => Promise<void>;
}

/** يربط مسح استعادة بيع الباقات: الحالة المعلقة، والمعالج الدوري، وهدف الاكتشاف الذي يسجّل جدولته. */
export function packageSaleRecovery(
  database: Pick<TenantWrappers, 'withTenant'>,
  clock: PackageSaleClock,
  options: { redisUrl: string; timeoutMs: number; prefix?: string },
) {
  const transactions = packageSaleRecoveryTransactions(database, { timeoutMs: options.timeoutMs });
  const scanTransactions = packageSaleRecoveryTransactions(database, {
    timeoutMs: PACKAGE_RECOVERY_SCAN_TIMEOUT_MS,
  });
  const processor = startPackageSaleRecoveryProcessor(
    new RecoverPackageSales(transactions, clock),
    options.redisUrl,
    options.prefix,
  );
  const target: PackageRecoveryTarget = {
    name: 'package-sale',
    hasPending: scanTransactions.hasPending,
    register: processor.register,
  };
  return { processor, target };
}

/** يربط مسح استعادة تثبيت استيراد الباقات بنفس الشكل، بميزانية المسح القصيرة لا ميزانية التثبيت. */
export function packageImportRecovery(
  database: Pick<TenantWrappers, 'withTenant'>,
  clock: PackageCommitClock,
  options: { redisUrl: string; prefix?: string },
) {
  const transactions = packageImportRecoveryTransactions(database, {
    timeoutMs: PACKAGE_RECOVERY_SCAN_TIMEOUT_MS,
  });
  const processor = startPackageImportRecoveryProcessor(
    new RecoverPackageImports(transactions, clock),
    options.redisUrl,
    options.prefix,
  );
  const target: PackageRecoveryTarget = {
    name: 'package-import-commit',
    hasPending: transactions.hasPending,
    register: processor.register,
  };
  return { processor, target };
}
