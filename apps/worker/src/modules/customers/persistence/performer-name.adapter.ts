import type { Tx } from '@pospay/db';
import { readEmployeeDisplayNames } from '../../staff/index.ts';
import { displaySafeFirstWord } from '../domain/display-name.ts';
import type { PerformerNamePort } from '../ports/performer-name.port.ts';

export const performerNameAdapter: PerformerNamePort<Tx> = {
  firstNames: async (tx, companyId, employeeIds) => {
    const stored = await readEmployeeDisplayNames(tx, companyId, employeeIds);
    return stored.map((name) => ({
      employeeId: name.employeeId,
      nameAr: displaySafeFirstWord(name.nameAr),
      nameEn: displaySafeFirstWord(name.nameEn),
    }));
  },
};
