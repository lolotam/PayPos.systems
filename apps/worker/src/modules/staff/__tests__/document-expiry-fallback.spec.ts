import { documentExpiringParameters as contractParameters } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { documentExpiringParameters } from '../domain/document-expiry-notice.ts';
import { STAFF_ALERT_NAME_FALLBACK } from '../domain/staff-name-fallbacks.ts';

const DOCUMENT = '01920000-0000-7000-8000-0000000000d1';

it('renders the Arabic bell without repeating «مستند» when both type names are rejected (issue #568)', () => {
  const parameters = documentExpiringParameters(
    null,
    'Sara',
    null,
    '123456',
    '2026-11-04',
    DOCUMENT,
    STAFF_ALERT_NAME_FALLBACK,
  );
  const values = Object.fromEntries((parameters ?? []).map((entry) => [entry.name, entry.value]));
  const rendered = t('ar', 'inApp.document_expiring').replace(
    /\{\{(\w+)\}\}/g,
    (_, name: string) => values[name] ?? '',
  );

  expect(rendered).toBe('مستند غير محدد الخاص بـ Sara ينتهي يوم 2026-11-04');
  expect(rendered.match(/مستند/g)).toHaveLength(1);
  expect(values['document_type_en']).toBe('Document');
  expect(contractParameters.safeParse(parameters).success).toBe(true);
});

it('keeps the English fallback and the accepted names untouched', () => {
  const values = Object.fromEntries(
    (
      documentExpiringParameters(
        'سارة',
        'Sara',
        'إقامة',
        'Residency',
        '2026-11-04',
        DOCUMENT,
        STAFF_ALERT_NAME_FALLBACK,
      ) ?? []
    ).map((entry) => [entry.name, entry.value]),
  );

  expect(values['document_type_ar']).toBe('إقامة');
  expect(values['document_type_en']).toBe('Residency');
});
