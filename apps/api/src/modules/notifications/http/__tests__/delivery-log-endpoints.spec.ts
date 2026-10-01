import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../../test/harness.ts';

let h: Harness;
let ownerCookie: string;
let company: string;
let businessA: string;
let branchA: string;
let businessB: string;
let branchB: string;

const PHONE = '+96500000001';
const ids = systemUuidV7();

beforeAll(async () => {
  h = await startHarness();
  ownerCookie = await h.signedInOperator('delivery-log-owner@example.test');
  company = await h.onboard(ownerCookie, 'Delivery Log Test Company');

  businessA = ids.newId();
  branchA = ids.newId();
  businessB = ids.newId();
  branchB = ids.newId();

  await h.owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${businessA}, ${company}, 'retail', 'Business A'), (${businessB}, ${company}, 'retail', 'Business B')`;
  await h.owner`INSERT INTO branches (id, company_id, business_id, name_en)
    VALUES (${branchA}, ${company}, ${businessA}, 'Branch A'), (${branchB}, ${company}, ${businessB}, 'Branch B')`;
});

afterAll(async () => {
  await h.close();
});

describe('delivery-log GET privacy', () => {
  it('never returns the full synthetic phone, hash or parameters in the GET response', async () => {
    const attemptId = ids.newId();
    await h.owner`
      INSERT INTO notification_attempts (company_id, id, business_id, branch_id, source_event_id, channel,
        template_key, template_revision, locale, provider_template_name, recipient_phone, recipient_hash,
        hash_key_id, phone_last3, safe_parameters, status, authorized_at, created_at, updated_at)
      VALUES (${company}, ${attemptId}, ${businessA}, ${branchA}, ${ids.newId()}, 'whatsapp', 'test_notice',
        1, 'ar', 'test_notice_ar', ${PHONE}, decode(repeat('01', 32), 'hex'), 'test-v1', '001',
        '[]', 'PENDING', now(), now(), now())`;

    const res = await h.send('GET', '/v1/notifications/delivery-log', {
      cookie: ownerCookie,
      company,
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(PHONE);
    expect(res.text).not.toContain('recipient_phone');
    expect(res.text).not.toContain('recipient_hash');
    expect(res.text).not.toContain('safe_parameters');
    expect(res.text).toContain('"phone_last3":"001"');
  });
});

describe('delivery-log business and branch scoping', () => {
  it('scopes results to the requested business and branch endpoints', async () => {
    const idA = ids.newId();
    const idB = ids.newId();
    await h.owner`
      INSERT INTO notification_attempts (company_id, id, business_id, branch_id, source_event_id, channel,
        template_key, template_revision, locale, recipient_hash, hash_key_id, phone_last3,
        safe_parameters, status, failure_code, outcome_known, authorized_at, finished_at, created_at, updated_at)
      VALUES
        (${company}, ${idA}, ${businessA}, ${branchA}, ${ids.newId()}, 'whatsapp', 'test_notice',
         1, 'ar', decode(repeat('01', 32), 'hex'), 'test-v1', '001', '[]', 'FAILED', 'CONFIG_INVALID', true, now(), now(), now(), now()),
        (${company}, ${idB}, ${businessB}, ${branchB}, ${ids.newId()}, 'whatsapp', 'test_notice',
         1, 'ar', decode(repeat('02', 32), 'hex'), 'test-v1', '002', '[]', 'FAILED', 'CONFIG_INVALID', true, now(), now(), now(), now())`;

    const resBiz = await h.send(
      'GET',
      `/v1/businesses/${businessA}/notifications/delivery-log`,
      { cookie: ownerCookie, company },
    );
    expect(resBiz.status).toBe(200);
    const bizItems = (resBiz.body['items'] as { id: string }[]).map((r) => r.id);
    expect(bizItems).toContain(idA);
    expect(bizItems).not.toContain(idB);

    const resBranch = await h.send(
      'GET',
      `/v1/branches/${branchA}/notifications/delivery-log`,
      { cookie: ownerCookie, company },
    );
    expect(resBranch.status).toBe(200);
    const branchItems = (resBranch.body['items'] as { id: string }[]).map((r) => r.id);
    expect(branchItems).toContain(idA);
    expect(branchItems).not.toContain(idB);
  });
});

describe('delivery-log cursor pagination', () => {
  it('traverses all pages returning each row exactly once', async () => {
    const seededIds: string[] = [];
    const baseTime = new Date('2026-10-01T12:00:00Z');
    for (let i = 0; i < 5; i += 1) {
      const rowId = ids.newId();
      seededIds.push(rowId);
      const createdAt = new Date(baseTime.getTime() - i * 1_000).toISOString();
      await h.owner`
        INSERT INTO notification_attempts (company_id, id, business_id, branch_id, source_event_id, channel,
          template_key, template_revision, locale, recipient_hash, hash_key_id, phone_last3,
          safe_parameters, status, failure_code, outcome_known, authorized_at, finished_at, created_at, updated_at)
        VALUES (${company}, ${rowId}, ${businessA}, ${branchA}, ${ids.newId()}, 'whatsapp', 'test_notice',
          1, 'ar', decode(repeat('03', 32), 'hex'), 'test-v1', '003', '[]', 'FAILED', 'CONFIG_INVALID', true, now(), now(), ${createdAt}, ${createdAt})`;
    }

    const seenIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    while (pages < 10) {
      pages += 1;
      const url: string =
        cursor === null
          ? `/v1/businesses/${businessA}/notifications/delivery-log?limit=2`
          : `/v1/businesses/${businessA}/notifications/delivery-log?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await h.send('GET', url, { cookie: ownerCookie, company });
      expect(res.status).toBe(200);
      const items = res.body['items'] as { id: string }[];
      for (const item of items) {
        if (seededIds.includes(item.id)) {
          seenIds.push(item.id);
        }
      }
      cursor = (res.body['next_cursor'] as string | null) ?? null;
      if (cursor === null) break;
    }

    expect(seenIds).toHaveLength(seededIds.length);
    expect(new Set(seenIds).size).toBe(seededIds.length);
    for (const seededId of seededIds) {
      expect(seenIds).toContain(seededId);
    }
  });
});
