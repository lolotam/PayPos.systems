import { describe, expect, it } from 'vitest';
import { whatsAppShareHref } from './employee-app-link';

describe('whatsAppShareHref', () => {
  it('encodes Arabic text, the newline and the link query separators', () => {
    const href = whatsAppShareHref(
      'افتحي اللينك ده عشان توصّلي تطبيق الموظفات بصالون الأميرة',
      'https://pos.pospay.systems/personal?company=c&business=b',
    );
    expect(href).toBe(
      'https://wa.me/?text=' +
        encodeURIComponent(
          'افتحي اللينك ده عشان توصّلي تطبيق الموظفات بصالون الأميرة\nhttps://pos.pospay.systems/personal?company=c&business=b',
        ),
    );
    expect(href).toContain('%0A');
    expect(href).toContain('%3Fcompany%3Dc%26business%3Db');
    expect(href).toContain(encodeURIComponent('الأميرة'));
  });
});
