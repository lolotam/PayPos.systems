export type LeaveContext = {
  mode: 'personal' | 'reception';
  company_id: string;
  business_id: string;
  user_id: string;
  expires_at: string;
  sessionEpoch: number;
  branch_id?: string;
};

export function leaveIdentity(context: LeaveContext): string {
  return JSON.stringify(context);
}
