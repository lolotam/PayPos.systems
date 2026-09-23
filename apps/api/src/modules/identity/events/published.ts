/**
 * بيتبعت مرة واحدة لما شركة جديدة تتسجل ومعاها عضوية الـ Owner الأولى، في نفس الـ transaction (onboard-company).
 */
export interface CompanyCreated {
  readonly company_id: string;
  readonly owner_user_id: string;
  readonly plan_id: string;
}

export const COMPANY_CREATED = 'CompanyCreated';
