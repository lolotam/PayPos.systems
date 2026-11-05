import { moneyToString, parseMoney } from '@pospay/domain';
import { cellDate, cellText, INVALID_CELL, type ImportCell } from './package-import-cells.ts';
import { allocatePackagePrice, validatePackageDefinition } from '@pospay/domain';

/** العناوين الثابتة لقالب الباقات، ثم عشرين مجموعة خدمات بترتيب الملف. */
export const PACKAGE_IMPORT_HEADERS = [
  'customer_phone',
  'name_en',
  'name_ar',
  'price_paid',
  'expires_on',
  'external_ref',
  ...Array.from({ length: 20 }, (_, index) => [
    `service_${index + 1}`,
    `sessions_${index + 1}`,
    `remaining_${index + 1}`,
  ]).flat(),
] as const;

/** لقطة الخدمات الخاصة بالنشاط، والسعر للعرض فقط. */
export interface PackageImportService {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
}

/** فهرس أسماء الخدمات بعد التطبيع؛ تكرار نفس الهوية لا يصنع غموضاً. */
export type PackageImportServiceIndex = ReadonlyMap<string, readonly PackageImportService[]>;

/**
 * يبني فهرساً واحداً للمعاينة مع حفظ آخر سجل مطابق لكل هوية كما في المطابقة الأصلية.
 *
 * @param services خدمات النشاط المتاحة
 * @returns فهرس الأسماء المطبعة مع إزالة تكرار الهوية لكل اسم
 */
export function indexPackageImportServices(
  services: readonly PackageImportService[],
): PackageImportServiceIndex {
  const names = new Map<string, Map<string, PackageImportService>>();
  for (const service of services) {
    for (const label of [service.name_en, service.name_ar]) {
      if (label === null) continue;
      const name = label.trim().toLowerCase();
      const matches = names.get(name) ?? new Map<string, PackageImportService>();
      matches.set(service.id, service);
      names.set(name, matches);
    }
  }
  return new Map([...names].map(([name, matches]) => [name, [...matches.values()]]));
}

/** خطأ آمن بلا قيمة الخلية أو رقم الهاتف الكامل. */
export interface PackageImportRowError {
  readonly row: number;
  readonly column: string;
  readonly code: string;
}

/** بيانات أولية مؤقتة؛ الهاتف يبقى في الذاكرة حتى قراءة العملاء المجمعة فقط. */
export interface ParsedPackageImportRow {
  readonly row: number;
  readonly phone: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price_paid: string;
  readonly expires_on: string;
  readonly external_ref: string;
  readonly components: readonly {
    readonly service_id: string;
    readonly sessions: number;
    readonly remaining: number;
    readonly list_price_snapshot: string;
    readonly component_value: string;
    readonly base_unit_value: string;
    readonly last_unit_value: string;
  }[];
}

/** نتيجة تحقق الصف لا تحمل الهاتف داخل الخطأ. */
export type PackageImportRowResult =
  | { readonly value: ParsedPackageImportRow; readonly errors: readonly [] }
  | { readonly value: null; readonly errors: readonly PackageImportRowError[] };

/**
 * يتحقق من صف الباقة ويقيّم جلساته بالفلوس؛ التواريخ الماضية مقبولة والسعر لا يتقرب.
 *
 * @param row رقم صف Excel الحقيقي
 * @param cells الخلايا بترتيب العناوين المرجعي
 * @param services خدمات النشاط المتاحة لمطابقة الأسماء
 * @returns صف صالح مؤقت أو أخطاء آمنة تحمل رقم الصف والعمود فقط
 */
export function parsePackageImportRow(
  row: number,
  cells: readonly ImportCell[],
  services: PackageImportServiceIndex,
): PackageImportRowResult {
  const errors: PackageImportRowError[] = [];
  const issue = (column: string, code: string) => errors.push({ row, column, code });
  const text = (index: number) => cellText(cells[index] ?? null);
  checkCells(cells, issue);
  const phone = text(0);
  if (phone === null || !/^\+[1-9]\d{1,14}$/.test(phone))
    issue('customer_phone', 'IMPORT_PHONE_INVALID');
  const nameEn = text(1);
  const nameAr = text(2);
  if (nameEn === null || !validName(nameEn)) issue('name_en', 'IMPORT_NAME_INVALID');
  if (nameAr !== null && !validName(nameAr)) issue('name_ar', 'IMPORT_NAME_INVALID');
  const price = readPrice(cells[3] ?? null, issue);
  const expiresOn = cellDate(cells[4] ?? null);
  if (expiresOn === null) issue('expires_on', 'IMPORT_DATE_INVALID');
  const externalRef = text(5);
  if (externalRef === null || externalRef.length > 100)
    issue('external_ref', 'IMPORT_EXTERNAL_REF_INVALID');
  const components = readComponents(cells, services, issue);
  try {
    validatePackageDefinition(price, components);
  } catch (error) {
    issue(
      'components',
      error instanceof Error && 'code' in error ? String(error.code) : 'INVALID_COMPONENTS',
    );
  }
  if (
    errors.length > 0 ||
    phone === null ||
    nameEn === null ||
    expiresOn === null ||
    externalRef === null
  )
    return { value: null, errors };
  const valued = allocatePackagePrice(price, components, 'session-count');
  return {
    errors: [],
    value: {
      row,
      phone,
      name_en: nameEn,
      name_ar: nameAr,
      price_paid: moneyToString(price),
      expires_on: expiresOn,
      external_ref: externalRef,
      components: serializeComponents(valued),
    },
  };
}

function readPrice(cell: ImportCell, issue: (column: string, code: string) => void): bigint {
  try {
    const price = parseMoney(cellText(cell) ?? '');
    if (price >= 0n) return price;
  } catch {
    // رفض الصيغة والسعر السالب لهما خطأ واحد على عمود السعر؛ مكونات الصف تُفحص بشكل مستقل.
  }
  issue('price_paid', 'INVALID_PRICE');
  return 0n;
}

function readComponents(
  cells: readonly ImportCell[],
  services: PackageImportServiceIndex,
  issue: (column: string, code: string) => void,
) {
  const components: {
    serviceId: string;
    sessions: number;
    remainingSessions: number;
    listPriceSnapshot: bigint;
  }[] = [];
  for (let group = 0; group < 20; group++) {
    const offset = 6 + group * 3;
    const values = [
      cellText(cells[offset] ?? null),
      cellText(cells[offset + 1] ?? null),
      cellText(cells[offset + 2] ?? null),
    ];
    if (values.every((value) => value === null)) continue;
    const column = `service_${group + 1}`;
    if (values.some((value) => value === null)) {
      issue(column, 'IMPORT_REQUIRED_CELL');
      continue;
    }
    const name = values[0]?.toLowerCase();
    const unique = services.get(name ?? '') ?? [];
    const service = unique[0];
    if (unique.length > 1) {
      issue(column, 'IMPORT_SERVICE_AMBIGUOUS');
      continue;
    }
    if (service === undefined) {
      issue(column, 'IMPORT_SERVICE_NOT_FOUND');
      continue;
    }
    const integer = (value: string | null | undefined) =>
      value !== null && value !== undefined && /^\d+$/.test(value) ? Number(value) : NaN;
    components.push({
      serviceId: service.id,
      sessions: integer(values[1]),
      remainingSessions: integer(values[2]),
      listPriceSnapshot: parseMoney(service.price),
    });
  }
  return components;
}

function serializeComponents(valued: ReturnType<typeof allocatePackagePrice>) {
  return valued.map((component) => {
    if (component.sessionValues === undefined) throw new Error('PACKAGE_IMPORT_ALLOCATION_INVALID');
    return {
      service_id: component.serviceId,
      sessions: component.sessions,
      remaining: component.remainingSessions ?? component.sessions,
      list_price_snapshot: moneyToString(component.listPriceSnapshot),
      component_value: moneyToString(component.componentValue),
      base_unit_value: moneyToString(component.sessionValues.base),
      last_unit_value: moneyToString(component.sessionValues.last),
    };
  });
}

function checkCells(cells: readonly ImportCell[], issue: (column: string, code: string) => void) {
  cells.forEach((cell, index) => {
    if (cell === INVALID_CELL)
      issue(PACKAGE_IMPORT_HEADERS[index] ?? 'unexpected_column', 'IMPORT_CELL_INVALID');
  });
}

function validName(name: string): boolean {
  return (
    name.length <= 255 &&
    ![...name].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  );
}
