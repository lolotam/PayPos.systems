import { describe, expect, it } from 'vitest';

import { parseManagerLink } from './manager-link';

const HOST = 'pos.staging.pospay.systems';
const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const QUERY = `company=${COMPANY}&business=${BUSINESS}`;
const link = (host = HOST, query = QUERY) => `https://${host}/personal?${query}`;

describe('parseManagerLink', () => {
  it('reads the company and the business out of the manager link', () => {
    expect(parseManagerLink(link(), HOST)).toEqual({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('ignores every other parameter of the link', () => {
    const raw = `${link()}&invite=7&branch=1&utm_source=whatsapp`;

    expect(parseManagerLink(raw, HOST)).toEqual({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('refuses a foreign host, a subdomain of it, another scheme, a port or another path', () => {
    expect(parseManagerLink(link('pos.example.com'), HOST)).toBeNull();
    expect(parseManagerLink(link(`evil.${HOST}`), HOST)).toBeNull();
    expect(parseManagerLink(link(`pospay.${HOST}`), HOST)).toBeNull();
    expect(parseManagerLink(`http://${HOST}/personal?${QUERY}`, HOST)).toBeNull();
    expect(parseManagerLink(`https://${HOST}:8443/personal?${QUERY}`, HOST)).toBeNull();
    expect(parseManagerLink(`https://${HOST}/personal/extra?${QUERY}`, HOST)).toBeNull();
    expect(parseManagerLink(`https://${HOST}/other?${QUERY}`, HOST)).toBeNull();
  });

  it('refuses a link without valid identifiers', () => {
    expect(parseManagerLink(`https://${HOST}/personal`, HOST)).toBeNull();
    expect(parseManagerLink(`https://${HOST}/personal?company=${COMPANY}`, HOST)).toBeNull();
    expect(parseManagerLink(`https://${HOST}/personal?business=${BUSINESS}`, HOST)).toBeNull();
    expect(parseManagerLink(link(HOST, 'company=abc&business=' + BUSINESS), HOST)).toBeNull();
    expect(parseManagerLink(link(HOST, `company=${COMPANY}&business=`), HOST)).toBeNull();
  });

  it('refuses something that is not a link at all', () => {
    expect(parseManagerLink('اللينك مش موجود', HOST)).toBeNull();
    expect(parseManagerLink('', HOST)).toBeNull();
    expect(parseManagerLink('pos.staging.pospay.systems/personal', HOST)).toBeNull();
  });
});
