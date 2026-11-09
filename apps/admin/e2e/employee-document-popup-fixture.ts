import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { t } from '@pospay/i18n';
import type * as Routes from './employee-document-popup-routes-fixture';

const require = createRequire(import.meta.url);
const {
  CIVIL,
  FIRST,
  KEYS,
  detailPayload,
  documents,
  employeesPayload,
  expectQuery,
  failure,
  matchRoute,
  sessionPayload,
  tenantFor,
  workspaces,
}: typeof Routes = require('./employee-document-popup-routes-fixture.ts');

export const API_ORIGIN = 'http://127.0.0.1:18130';
export const CONTROL_ORIGIN = 'http://127.0.0.1:18131';
export const ADMIN_ORIGIN = 'http://127.0.0.1:18132';
export const DESTINATION_ORIGIN = 'http://127.0.0.1:18133';
const RUN_ID = process.env['ADMIN_POPUP_RUN_ID'];
type Held = { response: ServerResponse; key: string; resolve: () => void };
const state = {
  readStatus: 200,
  omit: '',
  held: [] as Held[],
  requests: [] as string[],
  destinations: [] as string[],
  unknown: [] as string[],
};
const CORS = {
  'access-control-allow-origin': ADMIN_ORIGIN,
  'access-control-allow-credentials': 'true',
};
const OUTCOMES = ['success', 'network', 'invalid', 'denied', 'coop', 'attachment'];
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS }).end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage) {
  let text = '';
  for await (const part of req) {
    text += String(part);
    if (text.length > 4096) throw new Error('request body too large');
  }
  return JSON.parse(text) as Record<string, unknown>;
}
function exactFields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('control fields');
}
function preflight(req: IncomingMessage, res: ServerResponse, path: string, url: URL) {
  const method = req.headers['access-control-request-method'];
  if (req.headers.origin !== ADMIN_ORIGIN || (method !== 'GET' && method !== 'POST')) {
    throw new Error('preflight');
  }
  matchRoute(method, path, url);
  const requested = req.headers['access-control-request-headers'];
  const joined = Array.isArray(requested) ? requested.join(',') : requested;
  const names =
    joined
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean) ?? [];
  if (
    names.some((name) => name !== 'content-type' && name !== 'x-company-id') ||
    new Set(names).size !== names.length
  )
    throw new Error('headers');
  res
    .writeHead(204, {
      ...CORS,
      'access-control-allow-methods': 'GET,POST',
      'access-control-allow-headers': 'content-type,x-company-id',
    })
    .end();
}
async function download(req: IncomingMessage, res: ServerResponse) {
  tenantFor(req);
  if (req.headers['content-type'] !== 'application/json') throw new Error('download content type');
  const input = await readBody(req);
  const key = input['storage_key'];
  if (Object.keys(input).length !== 1 || typeof key !== 'string' || !KEYS.includes(key))
    throw new Error('body');
  await new Promise<void>((resolve) => {
    state.held.push({ response: res, key, resolve });
  });
}
function releaseHeld(key: string, outcome: string) {
  const index = state.held.findIndex((held) => held.key === key);
  const held = state.held[index];
  if (!held) throw new Error('held download missing');
  state.held.splice(index, 1);
  if (outcome === 'network') held.response.destroy();
  else if (outcome === 'invalid')
    send(held.response, 200, { download_url: 'invalid', expires_in: 60 });
  else if (outcome === 'denied') send(held.response, 403, failure(403));
  else {
    const suffix = key === CIVIL ? 'civil' : 'passport';
    const variant = outcome === 'coop' || outcome === 'attachment' ? `-${outcome}` : '';
    const download_url = `${DESTINATION_ORIGIN}/document/${suffix}${variant}`;
    send(held.response, 200, { download_url, expires_in: 60 });
  }
  held.resolve();
}
async function api(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', API_ORIGIN);
  const path = url.pathname;
  state.requests.push(`${req.method} ${req.url}`);
  try {
    if (req.headers.origin !== undefined && req.headers.origin !== ADMIN_ORIGIN)
      throw new Error('origin');
    if (req.method === 'OPTIONS') return preflight(req, res, path, url);
    const matched = matchRoute(req.method ?? '', path, url);
    if (matched.tenant && tenantFor(req) !== matched.tenant) throw new Error('wrong company');
    if (matched.kind === 'session') return send(res, 200, sessionPayload());
    if (matched.kind === 'workspaces') return send(res, 200, workspaces());
    if (matched.kind === 'count') {
      tenantFor(req);
      return send(res, 200, { count: 0 });
    }
    if (matched.kind === 'employees' && matched.tenant)
      return send(res, 200, employeesPayload(matched.tenant));
    if (matched.kind === 'detail' && matched.tenant) {
      const id = matched.path.split('/').pop() ?? FIRST;
      return send(res, 200, detailPayload(id, matched.tenant));
    }
    if (matched.kind === 'documents' && matched.tenant) {
      const id = matched.path.split('/').at(-2) ?? FIRST;
      if (state.readStatus !== 200)
        return send(res, state.readStatus, failure(state.readStatus, 'Documents are unavailable'));
      return send(res, 200, documents(id, state.omit));
    }
    if (matched.kind === 'download') return await download(req, res);
    tenantFor(req);
    return send(res, 403, failure(403));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failure';
    state.unknown.push(`${req.method} ${req.url}: ${message}`);
    if (!res.headersSent)
      send(res, 500, {
        code: 'FIXTURE_REJECTED',
        message_ar: t('ar', 'attendanceActions.REJECTED'),
        message_en: t('en', 'attendanceActions.REJECTED'),
      });
  }
}
async function controlRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', CONTROL_ORIGIN);
  try {
    expectQuery(url, {});
    if (req.method === 'GET' && url.pathname === '/health')
      return send(res, 200, { runId: RUN_ID });
    if (req.method === 'GET' && url.pathname === '/ledger')
      return send(res, 200, {
        requests: state.requests,
        destinations: state.destinations,
        unknown: state.unknown,
        held: state.held.map((held) => held.key),
      });
    if (req.method !== 'POST') throw new Error('control method');
    const input = await readBody(req);
    if (url.pathname === '/read') {
      exactFields(input, ['status', 'omit']);
      const status = input['status'];
      if (status !== 200 && status !== 403 && status !== 404) throw new Error('read status');
      state.readStatus = status;
      state.omit = input['omit'] === CIVIL ? CIVIL : '';
    } else if (url.pathname === '/release') {
      exactFields(input, ['key', 'outcome']);
      const outcome = input['outcome'];
      if (
        typeof input['key'] !== 'string' ||
        typeof outcome !== 'string' ||
        !OUTCOMES.includes(outcome)
      ) {
        throw new Error('release');
      }
      releaseHeld(input['key'], outcome);
    } else if (url.pathname === '/reset') {
      exactFields(input, []);
      for (const held of [...state.held]) releaseHeld(held.key, 'network');
      state.requests = [];
      state.destinations = [];
      state.unknown = [];
      state.readStatus = 200;
      state.omit = '';
    } else throw new Error('control path');
    send(res, 200, { ok: true });
  } catch {
    send(res, 500, {
      code: 'CONTROL_REJECTED',
      message_ar: t('ar', 'attendanceActions.REJECTED'),
      message_en: t('en', 'attendanceActions.REJECTED'),
    });
  }
}
function destination(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? '', DESTINATION_ORIGIN).pathname;
  const html = path === '/blank' || path === '/document/civil' || path === '/document/civil-coop';
  if (req.method !== 'GET' || (!html && path !== '/document/passport-attachment')) {
    state.unknown.push(`destination ${req.method} ${req.url}`);
    res.writeHead(500).end();
    return;
  }
  if (path.startsWith('/document/')) state.destinations.push(path);
  if (path === '/document/passport-attachment') {
    res
      .writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="synthetic.pdf"',
      })
      .end('%PDF-1.4 synthetic');
    return;
  }
  const headers: Record<string, string> = { 'content-type': 'text/html' };
  if (path === '/document/civil-coop') headers['cross-origin-opener-policy'] = 'same-origin';
  res.writeHead(200, headers).end(`<html><body><h1>Synthetic ${path}</h1></body></html>`);
}
async function controlFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${CONTROL_ORIGIN}${path}`, init);
  if (!response.ok) throw new Error(`fixture control ${response.status}`);
  return response;
}
export async function control(path: string, input: Record<string, unknown> = {}) {
  await controlFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
export async function ledger() {
  const response = await controlFetch('/ledger');
  return (await response.json()) as {
    requests: string[];
    destinations: string[];
    unknown: string[];
    held: string[];
  };
}
async function main() {
  const servers = [createServer(api), createServer(controlRequest), createServer(destination)];
  await Promise.all(
    servers.map(
      (server, index) =>
        new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen([18130, 18131, 18133][index] ?? 0, '127.0.0.1', () => resolve());
        }),
    ),
  );
  const stop = () => {
    for (const held of [...state.held]) releaseHeld(held.key, 'network');
    for (const server of servers) server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
