/**
 * بيتبعت لما business جديد يتضاف لشركة، في نفس transaction الإضافة (create-business).
 */
export interface BusinessCreated {
  readonly business_id: string;
  readonly company_id: string;
  readonly vertical_type: string;
}

/**
 * بيتبعت لما فرع جديد يتضاف لـ business، في نفس transaction الإضافة (create-branch).
 */
export interface BranchCreated {
  readonly branch_id: string;
  readonly business_id: string;
  readonly company_id: string;
}

export const BUSINESS_CREATED = 'BusinessCreated';
export const BRANCH_CREATED = 'BranchCreated';
