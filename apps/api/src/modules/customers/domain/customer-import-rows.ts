import {
  CUSTOMER_IMPORT_COLUMNS,
  CUSTOMER_IMPORT_INVALID_CELL,
  type CustomerImportBirthday,
  type CustomerImportCandidate,
  type CustomerImportCell,
  type CustomerImportCellValues,
  type CustomerImportRow,
  type CustomerImportRowColumn,
  type CustomerImportRowErrorCode,
  type CustomerImportRowIssue,
  type CustomerImportRowStatus,
  type CustomerImportSheetRow,
} from './customer-import.ts';
import { InvalidCustomerPhoneError } from './errors.ts';
import { maskPhone, normalizePhone } from './phone.ts';
import { isEmailShape, isNoteShape, validateBirthday } from './profile.ts';

const CONTROL_CHARACTERS = new RegExp(`[\\x00-\\x1F\\x7F-\\x9F]`);
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

type Choice<T> = { readonly value: T } | { readonly code: CustomerImportRowErrorCode };

const cellText = (cell: CustomerImportCell): string => (cell === null ? '' : String(cell).trim());

function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || !Number.isInteger(serial) || serial < 1 || serial > 2_958_465)
    return null;
  const date = new Date(EXCEL_EPOCH_MS + (serial < 60 ? serial + 1 : serial) * DAY_MS);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function birthdayIso(cell: CustomerImportCell): Choice<string | null> {
  if (typeof cell === 'number') {
    const iso = excelSerialToIsoDate(cell);
    return iso === null ? { code: 'IMPORT_DATE_INVALID' } : { value: iso };
  }
  const text = cellText(cell);
  if (text === '') return { value: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return { code: 'IMPORT_DATE_INVALID' };
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === text
    ? { value: text }
    : { code: 'IMPORT_DATE_INVALID' };
}

function readName(cell: CustomerImportCell): Choice<string> {
  const raw = cell === null ? '' : String(cell);
  if (CONTROL_CHARACTERS.test(raw)) return { code: 'IMPORT_NAME_INVALID' };
  const name = raw.trim();
  if (name === '') return { code: 'IMPORT_REQUIRED_CELL' };
  return [...name].length <= 200 ? { value: name } : { code: 'IMPORT_NAME_INVALID' };
}

function readCallingCode(cell: CustomerImportCell, defaultCode: string): Choice<string> {
  const text = cellText(cell);
  if (text === '') return { value: defaultCode };
  const code = text.replace(/^\+/, '');
  return /^[1-9][0-9]{0,2}(?![\s\S])/.test(code)
    ? { value: code }
    : { code: 'IMPORT_COUNTRY_CODE_INVALID' };
}

function readLocale(cell: CustomerImportCell): Choice<'ar' | 'en'> {
  const text = cellText(cell).toLowerCase();
  if (text === '') return { value: 'ar' };
  return text === 'ar' || text === 'en' ? { value: text } : { code: 'IMPORT_LOCALE_INVALID' };
}

function readGender(
  cell: CustomerImportCell,
  v: CustomerImportCellValues,
): Choice<'male' | 'female' | null> {
  const text = cellText(cell);
  if (text === '') return { value: null };
  if (text === v.male) return { value: 'male' };
  if (text === v.female) return { value: 'female' };
  return { code: 'IMPORT_GENDER_INVALID' };
}

function readBirthday(
  birthdayCell: CustomerImportCell,
  yearKnownCell: CustomerImportCell,
  v: CustomerImportCellValues,
): {
  readonly birthday: CustomerImportBirthday | null;
  readonly code?: CustomerImportRowErrorCode;
} {
  const cell = birthdayIso(birthdayCell);
  if ('code' in cell) return { birthday: null, code: cell.code };
  if (cell.value === null) return { birthday: null };
  const flagText = cellText(yearKnownCell);
  if (flagText === '') return { birthday: null, code: 'IMPORT_YEAR_KNOWN_REQUIRED' };
  if (flagText !== v.yes && flagText !== v.no)
    return { birthday: null, code: 'IMPORT_BOOLEAN_INVALID' };
  const [year, month, day] = cell.value.split('-').map(Number) as [number, number, number];
  const known = flagText === v.yes;
  try {
    validateBirthday(known ? { day, month, year } : { day, month });
    return { birthday: { day, month, year: known ? year : null } };
  } catch {
    return { birthday: null, code: 'IMPORT_DATE_INVALID' };
  }
}

function readOptionalText(
  cell: CustomerImportCell,
  valid: (value: string) => boolean,
  code: CustomerImportRowErrorCode,
): Choice<string | null> {
  const text = cellText(cell);
  if (text === '') return { value: null };
  return valid(text) ? { value: text } : { code };
}

function readTextFields(
  readable: (i: number) => CustomerImportCell,
  collect: (column: CustomerImportRowColumn, code: CustomerImportRowErrorCode) => void,
  v: CustomerImportCellValues,
) {
  const name = readName(readable(0));
  if ('code' in name) collect('name', name.code);
  const locale = readLocale(readable(3));
  if ('code' in locale) collect('locale', locale.code);
  const noRatingText = cellText(readable(4));
  const noRating = noRatingText === v.yes;
  if (noRatingText !== '' && !noRating) collect('no_rating', 'IMPORT_BOOLEAN_INVALID');
  const gender = readGender(readable(7), v);
  if ('code' in gender) collect('gender', gender.code);
  const email = readOptionalText(readable(8), isEmailShape, 'IMPORT_EMAIL_INVALID');
  if ('code' in email) collect('email', email.code);
  const note = readOptionalText(readable(9), isNoteShape, 'IMPORT_NOTE_INVALID');
  if ('code' in note) collect('notes', note.code);
  return {
    name: 'value' in name ? name.value : '',
    locale: ('value' in locale ? locale.value : 'ar') as 'ar' | 'en',
    noRating,
    gender: 'value' in gender ? gender.value : null,
    email: 'value' in email ? email.value : null,
    note: 'value' in note ? note.value : null,
  };
}

function readRow(
  row: number,
  cells: readonly CustomerImportCell[],
  defaultCallingCode: string,
  v: CustomerImportCellValues,
): CustomerImportCandidate {
  const errors: CustomerImportRowIssue[] = [];
  const collect = (column: CustomerImportRowColumn, code: CustomerImportRowErrorCode): void => {
    if (!errors.some((issue) => issue.column === column)) errors.push({ row, column, code });
  };
  const at = (i: number): CustomerImportCell => cells[i] ?? null;
  const readable = (i: number): CustomerImportCell =>
    at(i) === CUSTOMER_IMPORT_INVALID_CELL ? null : at(i);
  for (const [i, column] of CUSTOMER_IMPORT_COLUMNS.entries())
    if (at(i) === CUSTOMER_IMPORT_INVALID_CELL) collect(column, 'IMPORT_CELL_INVALID');
  const beyond = cells.slice(CUSTOMER_IMPORT_COLUMNS.length);
  if (beyond.some((cell) => cell === CUSTOMER_IMPORT_INVALID_CELL))
    collect('unexpected_column', 'IMPORT_CELL_INVALID');
  else if (beyond.some((cell) => cellText(cell) !== ''))
    collect('unexpected_column', 'IMPORT_COLUMN_UNEXPECTED');
  const cc = readCallingCode(readable(2), defaultCallingCode);
  if ('code' in cc) collect('country_code', cc.code);
  const phoneText = cellText(readable(1));
  let phone: string | null = null;
  if (phoneText === '') collect('phone', 'IMPORT_REQUIRED_CELL');
  else if (!('code' in cc)) {
    try {
      phone = normalizePhone({ calling_code: cc.value, national_number: phoneText });
    } catch (error) {
      if (!(error instanceof InvalidCustomerPhoneError)) throw error;
      collect('phone', 'IMPORT_PHONE_INVALID');
    }
  }
  const birthday = readBirthday(readable(5), readable(6), v);
  if (birthday.code !== undefined)
    collect(birthday.code === 'IMPORT_DATE_INVALID' ? 'birthday' : 'year_known', birthday.code);
  const text = readTextFields(readable, collect, v);
  return {
    row,
    name: text.name,
    phone,
    masked_phone: phone === null ? null : maskPhone(phone),
    locale: text.locale,
    no_rating: text.noRating,
    birthday: birthday.birthday,
    gender: text.gender,
    email: text.email,
    note: text.note,
    errors,
  };
}

/**
 * يحوّل ورقة العملاء إلى صفوف مرشّحة وأخطاء مسمّاة مع كشف تكرار الهاتف في الملف (CIM-04، D-8).
 *
 * @param rows               صفوف الورقة بعد فحص العناوين
 * @param defaultCallingCode كود اتصال دولة النشاط
 * @param values             قيم خلايا الاختيار المقبولة
 * @returns الصفوف المرشّحة وأخطاؤها
 */
export function validateCustomerImportSheet(
  rows: readonly CustomerImportSheetRow[],
  defaultCallingCode: string,
  values: CustomerImportCellValues,
): {
  readonly candidates: readonly CustomerImportCandidate[];
  readonly errors: readonly CustomerImportRowIssue[];
} {
  const candidates = rows.map((row) => readRow(row.row, row.cells, defaultCallingCode, values));
  const counts = new Map<string, number>();
  for (const c of candidates)
    if (c.phone !== null) counts.set(c.phone, (counts.get(c.phone) ?? 0) + 1);
  for (const c of candidates)
    if (
      c.phone !== null &&
      (counts.get(c.phone) ?? 0) > 1 &&
      !c.errors.some((e) => e.column === 'phone')
    )
      c.errors.push({ row: c.row, column: 'phone', code: 'IMPORT_DUPLICATE_IN_FILE' });
  return { candidates, errors: candidates.flatMap((c) => c.errors) };
}

/**
 * يقرر حالة كل صف بعد معرفة الهواتف الموجودة ويفرض النوع على العميل الجديد (CIM-03، CI-Q10، CI-Q19).
 *
 * @param candidates     الصفوف المرشّحة من فحص الورقة
 * @param existingPhones الهواتف الموجودة في الشركة بصيغة E.164
 * @returns الصفوف النظيفة وأخطاؤها
 */
export function finalizeCustomerImportRows(
  candidates: readonly CustomerImportCandidate[],
  existingPhones: ReadonlySet<string>,
): {
  readonly rows: readonly CustomerImportRow[];
  readonly errors: readonly CustomerImportRowIssue[];
} {
  const errors: CustomerImportRowIssue[] = [];
  const rows: CustomerImportRow[] = [];
  for (const c of candidates) {
    const status: CustomerImportRowStatus =
      c.phone !== null && existingPhones.has(c.phone) ? 'existing' : 'new';
    const rowErrors =
      status === 'new' && c.gender === null && !c.errors.some((e) => e.column === 'gender')
        ? [
            ...c.errors,
            { row: c.row, column: 'gender' as const, code: 'IMPORT_REQUIRED_CELL' as const },
          ]
        : c.errors;
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    rows.push({
      row: c.row,
      name: c.name,
      phone: c.phone ?? '',
      masked_phone: c.masked_phone ?? '',
      locale: c.locale ?? 'ar',
      no_rating: c.no_rating,
      birthday: c.birthday,
      gender: c.gender,
      email: c.email,
      note: c.note,
      status,
      warning: status === 'existing' && c.no_rating ? 'EXISTING_NO_RATING_IGNORED' : null,
    });
  }
  return { rows, errors };
}
