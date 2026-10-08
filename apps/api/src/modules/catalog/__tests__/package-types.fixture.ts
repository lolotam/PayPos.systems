import { systemUuidV7 } from '@pospay/ids';
import { createPackageTypeTransactions } from '../persistence/drizzle-package-type-transactions.ts';
import { CreatePackageTypeUseCase } from '../use-cases/create-package-type/create-package-type.usecase.ts';
import { UpdatePackageTypeUseCase } from '../use-cases/update-package-type/update-package-type.usecase.ts';
import { servicesFixture, termsFor } from './services.fixture.ts';

const ids = systemUuidV7();
export async function packageTypesFixture() {
  const f = await servicesFixture();
  const services = [];
  for (let i = 0; i < 21; i++)
    services.push(
      await f.create.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: { ...termsFor(`Service ${i}`), price: i === 0 ? '0.000' : '12.500' },
      }),
    );
  const transactions = createPackageTypeTransactions(f.db, ids);
  return {
    ...f,
    services,
    packageTransactions: transactions,
    createPackage: new CreatePackageTypeUseCase(transactions, ids, {
      now: () => new Date('2026-10-08T10:00:00Z'),
    }),
    updatePackage: new UpdatePackageTypeUseCase(transactions, {
      now: () => new Date('2026-10-08T11:00:00Z'),
    }),
  };
}
export type PackageFixture = Awaited<ReturnType<typeof packageTypesFixture>>;
export function packageTerms(f: PackageFixture, name = 'Synthetic package') {
  return {
    name_en: name,
    name_ar: null,
    price: '25.000',
    validity_days: 90,
    components: [{ service_id: f.services[0]?.id ?? '', sessions: 10 }],
  };
}
export async function grantPackages(f: PackageFixture, business = f.business) {
  for (const permission of ['read:package-types:business', 'manage:package-types:business'])
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${f.memberId},${permission},'ALLOW','BUSINESS',${business},'Synthetic grant',${f.userId})`;
}
