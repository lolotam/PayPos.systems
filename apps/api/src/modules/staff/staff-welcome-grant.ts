import { systemClock } from '../../shared/adapters/system-clock.ts';
import { runWithStaffWelcomeContext } from './persistence/staff-welcome-pin.adapter.ts';
import type { GrantEmployeeAccessCommand } from './ports/staff-access.port.ts';
import {
  GrantEmployeeAccessUseCase,
  type GrantEmployeeAccessResult,
} from './use-cases/grant-employee-access/grant-employee-access.ts';

/**
 * المنح وبريد الترحيب: نفس خطوات «إعطاء الدخول» بالظبط، وبريد الترحيب بيتكتب في معاملة
 * الخطوة الثالثة — جوّه نفس الكوميت، فمفيش بريد من غير منحة ملتومة.
 */
export class StaffWelcomeGrantUseCase extends GrantEmployeeAccessUseCase {
  override async execute(command: GrantEmployeeAccessCommand): Promise<GrantEmployeeAccessResult> {
    return runWithStaffWelcomeContext({ command, clock: systemClock }, () =>
      super.execute(command),
    );
  }
}
