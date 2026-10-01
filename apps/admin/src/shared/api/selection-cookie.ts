const YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COMPANY_COOKIE = 'pospay_company_id';
export const BUSINESS_COOKIE = 'pospay_business_id';
export const BRANCH_COOKIE = 'pospay_branch_id';

export interface SelectionChoice {
  companyId?: string | undefined;
  businessId?: string | undefined;
  branchId?: string | undefined;
}

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const hit = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  if (!hit) return undefined;
  const raw = hit.slice(prefix.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function writeCookie(name: string, value: string): void {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure}`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function uuidOrUndefined(value: string | undefined): string | undefined {
  return value !== undefined && UUID.test(value) ? value : undefined;
}

export function readSelection(): SelectionChoice {
  return {
    companyId: uuidOrUndefined(readCookie(COMPANY_COOKIE)),
    businessId: uuidOrUndefined(readCookie(BUSINESS_COOKIE)),
    branchId: uuidOrUndefined(readCookie(BRANCH_COOKIE)),
  };
}

function put(name: string, value: string | undefined): void {
  const id = uuidOrUndefined(value);
  if (id) writeCookie(name, id);
  else clearCookie(name);
}

export function writeSelection(choice: SelectionChoice): void {
  put(COMPANY_COOKIE, choice.companyId);
  put(BUSINESS_COOKIE, choice.businessId);
  put(BRANCH_COOKIE, choice.branchId);
}

export function clearSelection(): void {
  clearCookie(COMPANY_COOKIE);
  clearCookie(BUSINESS_COOKIE);
  clearCookie(BRANCH_COOKIE);
}

export function selectionMatches(current: SelectionChoice, next: SelectionChoice): boolean {
  return (
    current.companyId === next.companyId &&
    current.businessId === next.businessId &&
    current.branchId === next.branchId
  );
}
