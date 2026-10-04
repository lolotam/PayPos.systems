export { staffControllers, staffProviders } from './staff.module.ts';
export type { SalaryChanged, EmployeeDocumentRecorded } from './events/published.ts';

export { createPersonalEligibility } from './persistence/personal-employee.ts';
export { createActivePasskeyBindings } from './queries/active-passkey-bindings.query.ts';
