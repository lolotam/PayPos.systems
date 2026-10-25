import type {
  AttendanceStatementHttpFixture,
  StatementRequestOptions,
} from './attendance-statement-http.fixture.ts';
import {
  seedDocumentBytes,
  seedStatementRequest,
  seedStatusHash,
} from './attendance-statement-api.fixture.ts';

export function statementRoute(
  f: AttendanceStatementHttpFixture,
  renderId: string,
  options: StatementRequestOptions = {},
) {
  return `/v1/businesses/${options.businessId ?? f.business}/branches/${options.branchId ?? f.branch}/attendance-statements/${renderId}`;
}

export function statementStatusHttp(
  f: AttendanceStatementHttpFixture,
  renderId: string,
  options: StatementRequestOptions = {},
) {
  return f.h.send('GET', statementRoute(f, renderId, options), {
    cookie: options.cookie ?? f.cookie,
    company: f.company,
  });
}

export function collectStatementHttp(
  f: AttendanceStatementHttpFixture,
  renderId: string,
  options: StatementRequestOptions = {},
) {
  return f.h.app.inject({
    method: 'POST',
    url: `${statementRoute(f, renderId, options)}/download`,
    headers: { cookie: options.cookie ?? f.cookie, 'x-company-id': f.company },
  });
}

export async function readyStatement(f: AttendanceStatementHttpFixture) {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'READY', mimeType: 'application/pdf' });
  await seedDocumentBytes(f, renderId);
  return renderId;
}

export function statementAudits(f: AttendanceStatementHttpFixture, renderId: string) {
  return f.h.owner`SELECT entity, entity_id, action, actor_user_id, "after" FROM audit_log
    WHERE company_id = ${f.company} AND entity = 'attendance_statement' AND entity_id = ${renderId}`;
}
