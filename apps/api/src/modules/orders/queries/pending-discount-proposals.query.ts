import {
  pendingDiscountProposalCursor,
  pendingDiscountProposalPage,
  pendingDiscountProposalQuery,
  type PendingDiscountProposalCursor,
  type PendingDiscountProposalPage,
  type PendingDiscountProposalQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { SessionDayReadError, type SessionDayScope } from './branch-day-service-sessions.query.ts';
import type { DiscountProposalPlaceAccess } from './requester-discount-proposals.query.ts';

type PerformerRow = { employee_id: string; first_name_en: string; first_name_ar: string | null };

type PendingRow = {
  id: string;
  request_id: string;
  kind: string;
  session_id: string | null;
  occurred_at: string;
  service_id: string;
  service_name_en: string;
  service_name_ar: string | null;
  list_price: string;
  price: string;
  discount: string;
  net: string;
  effective_bps: number;
  terms_hash: string;
  requester_name_ar: string | null;
  requester_name_en: string | null;
  requester_role: string;
  requester_role_is_system: boolean;
  requester_role_name_ar: string | null;
  requester_role_name_en: string;
  customer_first_name: string;
  requested_at: string;
  expires_at: string;
  line_id: string | null;
  base_revision: number | null;
  base_price: string | null;
  base_discount: string | null;
  base_net: string | null;
  performers: PerformerRow[];
};

const occurred = sql`to_char(d.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const requestedAt = sql`to_char(d.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const expiresAt = sql`to_char(d.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function cursorScope(scope: SessionDayScope) {
  return { v: 1 as const, company: scope.companyId, business: scope.businessId, branch: scope.branchId };
}

function decode(scope: SessionDayScope, query: PendingDiscountProposalQuery): PendingDiscountProposalCursor | null {
  if (query.cursor === undefined) return null;
  try {
    const bytes = Buffer.from(query.cursor, 'base64url');
    if (bytes.toString('base64url') !== query.cursor) throw new Error();
    const cursor = pendingDiscountProposalCursor.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.company === scope.companyId && cursor.business === scope.businessId && cursor.branch === scope.branchId) return cursor;
  } catch { /* بيانات المؤشر لا تدخل التشخيصات. */ }
  throw new SessionDayReadError('VALIDATION_FAILED');
}

// شاشة الموافقين: طلبات الفرع المعلّقة الحيّة فقط، بما يكفي الموافقة أن يقرر، وبلا هاتف ولا اسم كامل.
export function pendingDiscountProposalsStatement(scope: SessionDayScope, query: PendingDiscountProposalQuery, now: Date) {
  const cursor = decode(scope, query);
  const before = cursor === null
    ? sql``
    : sql`AND (d.requested_at,d.id)<(${cursor.at}::text::timestamptz,${cursor.id}::uuid)`;
  return sql`SELECT d.id,d.request_id,d.kind,d.session_id,${occurred} AS occurred_at,d.service_id,d.service_name_en,d.service_name_ar,
    d.terms->>'list_price' AS list_price,d.terms->>'price' AS price,d.terms->>'discount' AS discount,d.terms->>'net' AS net,
    d.effective_bps,d.terms_hash,d.requester_name_ar,d.requester_name_en,d.requester_role,d.requester_role_is_system,
    d.requester_role_name_ar,d.requester_role_name_en,d.customer_first_name,
    ${requestedAt} AS requested_at,${expiresAt} AS expires_at,
    d.line_id,d.base_revision,d.base_price::text AS base_price,d.base_discount::text AS base_discount,d.base_net::text AS base_net,
    COALESCE(perf.items,'[]'::json) AS performers
    FROM discount_proposals d
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('employee_id',p.employee_id,'first_name_en',p.first_name_en,'first_name_ar',p.first_name_ar)
        ORDER BY p.employee_id) AS items
      FROM discount_proposal_performers p
      WHERE p.company_id=d.company_id AND p.business_id=d.business_id AND p.proposal_id=d.id) perf ON true
    WHERE d.company_id=${scope.companyId} AND d.business_id=${scope.businessId} AND d.branch_id=${scope.branchId}
      AND d.status='PENDING' AND d.expires_at > ${now.toISOString()}::timestamptz ${before}
    ORDER BY d.requested_at DESC NULLS LAST,d.id DESC NULLS LAST LIMIT ${query.limit + 1}`;
}

function requesterSnapshot(row: PendingRow) {
  return {
    nameAr: row.requester_name_ar,
    nameEn: row.requester_name_en,
    role: row.requester_role,
    roleIsSystem: row.requester_role_is_system,
    roleNameAr: row.requester_role_name_ar,
    roleNameEn: row.requester_role_name_en,
  };
}

function toItem(row: PendingRow) {
  const common = {
    id: row.id,
    request_id: row.request_id,
    session_id: row.session_id,
    occurred_at: row.occurred_at,
    service_id: row.service_id,
    service_name_en: row.service_name_en,
    service_name_ar: row.service_name_ar,
    list_price: row.list_price,
    price: row.price,
    discount: row.discount,
    net: row.net,
    effective_bps: row.effective_bps,
    performers: row.performers,
    requester_label_ar: editorLabel('ar', requesterSnapshot(row)),
    requester_label_en: editorLabel('en', requesterSnapshot(row)),
    customer_first_name: row.customer_first_name,
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    terms_hash: row.terms_hash,
  };
  if (row.kind !== 'EDIT') return { kind: 'RECORD' as const, ...common };
  if (row.line_id === null || row.base_revision === null || row.base_price === null ||
    row.base_discount === null || row.base_net === null) {
    throw new SessionDayReadError('VALIDATION_FAILED');
  }
  return {
    kind: 'EDIT' as const,
    ...common,
    line_id: row.line_id,
    base_revision: row.base_revision,
    base_price: row.base_price,
    base_discount: row.base_discount,
    base_net: row.base_net,
  };
}

export class PendingDiscountProposalsQuery {
  constructor(
    private readonly db: TenantWrappers,
    private readonly access: DiscountProposalPlaceAccess,
    private readonly clock: { now(): Date },
  ) {}

  async execute(scope: SessionDayScope, input: unknown): Promise<PendingDiscountProposalPage> {
    const query = pendingDiscountProposalQuery.parse(input);
    const statement = pendingDiscountProposalsStatement(scope, query, this.clock.now());
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (!await this.access.place(tx, scope)) throw new SessionDayReadError('FORBIDDEN');
      const rows = await tx.execute<PendingRow>(statement);
      const items = rows.slice(0, query.limit).map(toItem);
      const last = rows[query.limit - 1];
      return pendingDiscountProposalPage.parse({
        items,
        next_cursor: rows.length > query.limit && last !== undefined
          ? Buffer.from(JSON.stringify({ ...cursorScope(scope), at: last.requested_at, id: last.id })).toString('base64url')
          : null,
      });
    }, { userId: scope.userId });
  }
}
