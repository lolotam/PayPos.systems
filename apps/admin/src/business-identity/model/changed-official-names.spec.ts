import { expect, it } from 'vitest';
import { changedOfficialNames, type OfficialNames } from './changed-official-names';

const known: OfficialNames = { official_name_ar: 'Alpha', official_name_en: 'Shop' };

it('sends only the name that differs from the saved baseline', () => {
  const change = changedOfficialNames(
    { official_name_ar: 'Alpha', official_name_en: '  New shop  ' },
    known,
    { official_name_ar: true, official_name_en: true },
  );
  expect(change).toEqual({ ok: true, body: { official_name_en: 'New shop' } });
});

it('clears a saved name when the changed field is empty', () => {
  const change = changedOfficialNames(
    { official_name_ar: '   ', official_name_en: 'Shop' },
    known,
    {},
  );
  expect(change).toEqual({ ok: true, body: { official_name_ar: null } });
});

it('omits a name typed and then returned to the saved value', () => {
  const change = changedOfficialNames(
    { official_name_ar: 'Alpha', official_name_en: 'Shop' },
    known,
    { official_name_en: true },
  );
  expect(change).toEqual({ ok: false, reason: 'empty' });
});

it('does not clear names the caller cannot see unless that field was edited', () => {
  const untouched = changedOfficialNames({ official_name_ar: '', official_name_en: '' }, null, {});
  expect(untouched).toEqual({ ok: false, reason: 'empty' });
  const edited = changedOfficialNames({ official_name_ar: '', official_name_en: 'Typed' }, null, {
    official_name_en: true,
  });
  expect(edited).toEqual({ ok: true, body: { official_name_en: 'Typed' } });
});

it('rejects a name the contract will not accept', () => {
  const change = changedOfficialNames(
    { official_name_ar: 'A', official_name_en: 'x'.repeat(256) },
    { official_name_ar: null, official_name_en: null },
    {},
  );
  expect(change).toEqual({ ok: false, reason: 'invalid' });
});
