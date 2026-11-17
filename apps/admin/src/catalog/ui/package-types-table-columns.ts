import type { PackageTypeListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { ColumnDef } from '@tanstack/react-table';

export function packageTypesTableColumns(locale: Locale): ColumnDef<PackageTypeListItem>[] {
  return [
    { id: 'name', header: t(locale, 'catalogPackageTypes.nameEn') },
    { id: 'price', header: t(locale, 'catalogPackageTypes.price') },
    { id: 'validity', header: t(locale, 'catalogPackageTypes.validity') },
    { id: 'components', header: t(locale, 'catalogPackageTypes.componentCount') },
    { id: 'selling', header: t(locale, 'catalogPackageTypes.selling') },
    { id: 'edit', header: t(locale, 'catalogPackageTypes.edit') },
  ];
}
