export type LeaveContext = {
  mode: 'personal' | 'reception';
  company_id: string;
  business_id: string;
  user_id: string;
  employee_id?: string;
  expires_at: string;
  sessionEpoch: number;
  branch_id?: string;
  timezone?: string;
};

export function leaveIdentity(context: LeaveContext): string {
  const identity = { ...context };
  delete identity.timezone;
  return JSON.stringify(identity);
}
