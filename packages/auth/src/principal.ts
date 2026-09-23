import type { AuthService } from './config.ts';

/**
 * نطاق عضوية واحدة (ADR-0003 §4) — بيتملى في T9a-2.
 */
export interface MembershipScope {
  readonly companyId: string;
  readonly scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
}

/**
 * صلاحية واحدة بيقيّمها الـ guard. الـ DENY بيفضل موجود ومبيتطرحش مقدماً — بيتقيّم عند الـ scope المطلوب.
 */
export interface Grant {
  readonly permission: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly source: 'role' | 'override' | 'device' | 'api-key' | 'platform';
  readonly scopeType: 'PLATFORM' | 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string | null;
}

/**
 * مين بيعمل الطلب (ADR-0003 §4). الـ companyId عمره ما بييجي من الـ client؛ بيتأكد من الـ memberships في T9a-2.
 */
export interface Principal {
  readonly kind: 'user' | 'device' | 'api-key';
  readonly userId: string | null;
  readonly employeeId: string | null;
  readonly companyId: string | null;
  readonly deviceId: string | null;
  readonly memberships: readonly MembershipScope[];
  readonly grants: readonly Grant[];
}

/**
 * الـ principal ومعاه الـ Set-Cookie اللي لازم ترجع مع الرد لو الـ session اتجددت.
 */
export interface ResolvedPrincipal {
  readonly principal: Principal;
  readonly setCookies: readonly string[];
}

/**
 * بيتحقق من الـ session cookie ويرجّع الـ principal بتاع المستخدم (path A). لحد T9a-2 الـ memberships والـ grants
 * فاضيين والشركة null — يعني مفيش صلاحية على أي حاجة غير إنه مسجّل دخول.
 *
 * @param auth    الـ AuthService
 * @param headers headers الطلب (فيها الـ cookie)
 * @returns الـ principal وcookies التجديد، أو null لو مفيش session صالحة
 */
export async function resolveUserPrincipal(
  auth: AuthService,
  headers: Headers,
): Promise<ResolvedPrincipal | null> {
  const session = await auth.getSession(headers);
  if (session === null) return null;
  return {
    principal: {
      kind: 'user',
      userId: session.userId,
      employeeId: null,
      companyId: null,
      deviceId: null,
      memberships: [],
      grants: [],
    },
    setCookies: session.setCookies,
  };
}
