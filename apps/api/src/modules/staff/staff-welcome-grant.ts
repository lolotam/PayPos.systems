import type { StaffAccessGrantAdmission } from './ports/staff-access-admission.port.ts';
import type { StaffWelcomePinContextPort } from './ports/staff-access-commit.port.ts';
import type {
  GrantEmployeeAccessCommand,
  GrantEmployeeAccessSteps,
  StaffAccessGrantCache,
  StaffAccessIds,
  StaffAccessUserSteps,
} from './ports/staff-access.port.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import {
  GrantEmployeeAccessUseCase,
  type GrantEmployeeAccessResult,
} from './use-cases/grant-employee-access/grant-employee-access.ts';

/**
 * المنح وبريد الترحيب: نفس خطوات «إعطاء الدخول» بالظبط، وبريد الترحيب بيتكتب في معاملة
 * الخطوة الثالثة — جوّه نفس الكوميت، فمفيش بريد من غير منحة ملتومة.
 */
export class StaffWelcomeGrantUseCase extends GrantEmployeeAccessUseCase {
  readonly #welcome: StaffWelcomePinContextPort;

  constructor(
    steps: GrantEmployeeAccessSteps,
    users: StaffAccessUserSteps,
    cache: StaffAccessGrantCache,
    clock: Clock,
    ids: StaffAccessIds,
    admission: StaffAccessGrantAdmission,
    welcome: StaffWelcomePinContextPort,
  ) {
    super(steps, users, cache, clock, ids, admission);
    this.#welcome = welcome;
  }

  override async execute(command: GrantEmployeeAccessCommand): Promise<GrantEmployeeAccessResult> {
    return this.#welcome.runWithPin(command, () => super.execute(command));
  }
}
