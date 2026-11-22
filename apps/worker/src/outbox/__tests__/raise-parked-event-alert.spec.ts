import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import type { ClaimedEvent, Database } from '@pospay/db';
import { describe, expect, it, vi } from 'vitest';

import {
  raiseParkedEventAlert,
  type ParkedEventAlertDeps,
  type ParkedEventAlertRequest,
} from '../raise-parked-event-alert.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const EVENT_ID = '01970000-0000-7000-8000-000000000001';

const parked = (eventType: string, payload: unknown = { amount: '123.456', phone: '+96550000000' }): ClaimedEvent => ({
  companyId: COMPANY,
  id: EVENT_ID,
  aggregateType: 'service_session',
  aggregateId: EVENT_ID,
  eventType,
  payload,
  attempt: 10,
});

function harness(options: { alreadyAlerted?: boolean; sinkFails?: boolean; tenantFails?: boolean } = {}) {
  const tenants: string[] = [];
  const requests: ParkedEventAlertRequest[] = [];
  const logged: unknown[] = [];
  const seen = new Set<string>(options.alreadyAlerted === true ? [EVENT_ID] : []);
  // withTenant هنا حدّ قاعدة البيانات: يمرّر معاملة وهمية، والمهم أنه يُفتح لشركة الحدث وحدها.
  const withTenant = (async (companyId: string, run: (tx: never) => Promise<unknown>) => {
    if (options.tenantFails === true) throw new Error('database unavailable');
    tenants.push(companyId);
    return run({} as never);
  }) as unknown as Database['withTenant'];
  const deps: ParkedEventAlertDeps = {
    app: { withTenant },
    sink: {
      request: async (_tx, request) => {
        if (options.sinkFails === true) throw new Error('sink failed');
        requests.push(request);
        const created = !seen.has(request.eventId);
        seen.add(request.eventId);
        return created;
      },
    },
    logger: { error: vi.fn((...args: unknown[]) => void logged.push(args)) },
  };
  return { deps, tenants, requests, logged };
}

describe('raiseParkedEventAlert', () => {
  it.each(COMMISSION_INPUT_EVENT_TYPES)('raises one alert for a parked %s, in the event company only', async (type) => {
    const { deps, tenants, requests } = harness();

    const outcome = await raiseParkedEventAlert(deps, parked(type));

    expect(outcome).toBe('RAISED');
    expect(tenants).toEqual([COMPANY]);
    expect(requests).toEqual([{ companyId: COMPANY, eventId: EVENT_ID, eventType: type }]);
  });

  it('raises nothing for a parked event of a type outside the six counted types', async () => {
    const { deps, tenants, requests } = harness();

    const outcome = await raiseParkedEventAlert(deps, parked('OrderCompleted'));

    expect(outcome).toBe('IGNORED');
    expect(tenants).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('hands over the company, the event id and the type only, never the payload', async () => {
    const { deps, requests } = harness();

    await raiseParkedEventAlert(deps, parked('SalaryChanged'));

    expect(Object.keys(requests[0] ?? {}).sort()).toEqual(['companyId', 'eventId', 'eventType']);
    expect(JSON.stringify(requests)).not.toContain('123.456');
    expect(JSON.stringify(requests)).not.toContain('+96550000000');
  });

  it('reports a duplicate instead of a second alert when the event was already alerted', async () => {
    const { deps } = harness();

    const first = await raiseParkedEventAlert(deps, parked('SalaryChanged'));
    const second = await raiseParkedEventAlert(deps, parked('SalaryChanged'));

    expect([first, second]).toEqual(['RAISED', 'DUPLICATE']);
  });

  it.each([
    { name: 'the sink fails', options: { sinkFails: true } },
    { name: 'the tenant transaction cannot open', options: { tenantFails: true } },
  ])('logs the company, event id and type and resolves FAILED when $name', async ({ options }) => {
    const { deps, logged } = harness(options);

    const outcome = await raiseParkedEventAlert(deps, parked('PackageSaleChanged'));

    expect(outcome).toBe('FAILED');
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).toContain(EVENT_ID);
    expect(JSON.stringify(logged)).not.toContain('123.456');
  });
});
