import type { z } from 'zod';

const V4 = '00000000-0000-4000-8000-000000000001';
const V7 = '01920000-0000-7000-8000-000000000001';
const STRINGS = [
  'Sara', 'staff', '965', '50000000', '***12', '***123', '1.000', '0.000', '7.125', '0.5000',
  '09:00', '09:15', '2026-10', '2026-10-18', '2026-10-18T12:00:00.000Z', '2026-10-18T12:00:00Z',
  'a'.repeat(64), 'https://example.com/a', 'read:orders:branch', 'orders', 'ERROR_CODE', 'X', 'AB',
  'ar', 'en', 'confirmed', 'Asia/Kuwait', 'application/pdf',
];

type Schema = z.ZodType;
type Def = {
  type: string;
  options?: readonly Schema[];
  element?: Schema;
  items?: readonly Schema[];
  innerType?: Schema;
  in?: Schema;
  values?: readonly unknown[];
  entries?: Record<string, unknown>;
  version?: string;
  format?: string;
  keyType?: Schema;
  valueType?: Schema;
  left?: Schema;
  right?: Schema;
  getter?: () => Schema;
};

const defOf = (schema: Schema) => schema.def as Def;
const bagOf = (schema: Schema) =>
  ((schema as { _zod?: { bag?: Record<string, unknown> } })._zod?.bag ?? {}) as {
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    format?: string;
  };

function inner(schema: Schema): Schema | undefined {
  const def = defOf(schema);
  if (def.innerType) return def.innerType;
  if (def.type === 'pipe') return def.in;
  if (def.type === 'lazy') return def.getter?.();
  return undefined;
}

function containsObject(schema: Schema, stack: object[] = []): boolean {
  if (stack.includes(schema)) return false;
  const next = [...stack, schema];
  const def = defOf(schema);
  if (def.type === 'object' || def.type === 'record' || def.type === 'intersection') return true;
  if (def.type === 'array' && def.element) return containsObject(def.element, next);
  if (def.type === 'union') return (def.options ?? []).some((option) => containsObject(option, next));
  if (def.type === 'tuple') return (def.items ?? []).some((item) => containsObject(item, next));
  const nested = inner(schema);
  return nested ? containsObject(nested, next) : false;
}

export function hasNestedSchema(schema: Schema, stack: object[] = []): boolean {
  if (stack.includes(schema)) return false;
  const next = [...stack, schema];
  const def = defOf(schema);
  if (def.type === 'object') {
    return Object.values((schema as z.ZodObject).shape).some((field) => containsObject(field as Schema, next));
  }
  if (def.type === 'union') return (def.options ?? []).some((option) => hasNestedSchema(option, next));
  const nested = inner(schema);
  return nested ? hasNestedSchema(nested, next) : false;
}

function stringSample(schema: Schema): string {
  const bag = bagOf(schema);
  const def = defOf(schema);
  const format = bag.format ?? def.format;
  if (format === 'uuid') return def.version === 'v7' ? V7 : V4;
  if (format === 'date') return '2026-10-18';
  if (format === 'time') return '09:00:00';
  if (format === 'datetime' || format === 'date-time') return '2026-10-18T12:00:00.000Z';
  if (format === 'email') return 'sara@example.com';
  if (format === 'url' || format === 'uri') return 'https://example.com/a';
  const min = bag.minimum ?? 0;
  const max = bag.maximum ?? Number.POSITIVE_INFINITY;
  const match = STRINGS.find((value) => value.length >= min && value.length <= max && schema.safeParse(value).success);
  if (match) return match;
  throw new Error(`no string for ${format ?? 'string'} min=${min}`);
}

function numberSample(schema: Schema): number {
  const bag = bagOf(schema);
  let min = typeof bag.minimum === 'number' ? bag.minimum : 0;
  let max = typeof bag.maximum === 'number' ? bag.maximum : undefined;
  const checks = (schema as { _zod?: { def?: { checks?: { _zod?: { def?: { check?: string; value?: number; inclusive?: boolean } } }[] } } })._zod?.def?.checks ?? [];
  for (const check of checks) {
    const checkDef = check._zod?.def;
    if (!checkDef || typeof checkDef.value !== 'number') continue;
    if (checkDef.check === 'greater_than') min = checkDef.inclusive ? checkDef.value : checkDef.value + 1;
    if (checkDef.check === 'less_than') max = checkDef.inclusive ? checkDef.value : checkDef.value - 1;
  }
  if (typeof bag.exclusiveMinimum === 'number') min = bag.exclusiveMinimum + 1;
  const value = max != null && min > max ? max : min;
  for (const candidate of [value, 0, 1, 2, 7]) {
    if (schema.safeParse(candidate).success) return candidate;
  }
  throw new Error(`no number min=${min}`);
}

function arrayCount(schema: Schema, element: Schema): number {
  let min = 0;
  let max = 8;
  const checks = ((schema as { _zod?: { def?: { checks?: { _zod?: { def?: { check?: string; minimum?: number; maximum?: number; length?: number } } }[] } } })._zod?.def?.checks ?? []);
  for (const check of checks) {
    const checkDef = check._zod?.def;
    if (!checkDef) continue;
    if (checkDef.check === 'min_length' && checkDef.minimum != null) min = checkDef.minimum;
    if (checkDef.check === 'max_length' && checkDef.maximum != null) max = checkDef.maximum;
    if (checkDef.check === 'length_equals' && checkDef.length != null) {
      min = checkDef.length;
      max = checkDef.length;
    }
  }
  let count = min;
  if (containsObject(element) && count < 1 && max >= 1) count = 1;
  return Math.min(count, max);
}

function build(schema: Schema, stack: object[] = []): unknown {
  if (stack.includes(schema)) throw new Error(`cycle at ${defOf(schema).type}`);
  const next = [...stack, schema];
  const def = defOf(schema);
  switch (def.type) {
    case 'string':
      return stringSample(schema);
    case 'number':
      return numberSample(schema);
    case 'int':
      return numberSample(schema);
    case 'boolean':
      return schema.safeParse(true).success ? true : false;
    case 'bigint':
      return 1n;
    case 'null':
      return null;
    case 'undefined':
    case 'void':
      return undefined;
    case 'any':
    case 'unknown':
      return null;
    case 'literal':
      return def.values?.[0];
    case 'enum':
      return Object.values(def.entries ?? {})[0];
    case 'optional':
    case 'default':
    case 'prefault':
      return def.innerType && containsObject(def.innerType, next) ? build(def.innerType, next) : undefined;
    case 'nullable':
      return def.innerType && containsObject(def.innerType, next) ? build(def.innerType, next) : null;
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      return def.innerType ? build(def.innerType, next) : undefined;
    case 'pipe':
    case 'lazy':
      return inner(schema) ? build(inner(schema) as Schema, next) : undefined;
    case 'array':
      return Array.from({ length: arrayCount(schema, def.element as Schema) }, () => build(def.element as Schema, next));
    case 'tuple':
      return (def.items ?? []).map((item) => build(item, next));
    case 'union':
      return unionSample(schema, next);
    case 'object':
      return objectSample(schema, next);
    case 'record':
      return { [String(build(def.keyType as Schema, next))]: build(def.valueType as Schema, next) };
    case 'intersection':
      return { ...(build(def.left as Schema, next) as object), ...(build(def.right as Schema, next) as object) };
    default:
      throw new Error(`unsupported ${def.type}`);
  }
}

function objectSample(schema: Schema, stack: object[]): Record<string, unknown> {
  const shape = (schema as z.ZodObject).shape as Record<string, Schema>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    const value = build(field, stack);
    if (value !== undefined) out[key] = value;
  }
  const first = Object.entries(shape)[0];
  if (first && Object.keys(out).length === 0) {
    const [key, field] = first;
    let current = field;
    while (defOf(current).innerType && defOf(current).type !== 'nullable') current = defOf(current).innerType as Schema;
    const value = build(current, stack);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function unionSample(schema: Schema, stack: object[]): unknown {
  const options = [...(defOf(schema).options ?? [])].sort(
    (left, right) => Number(hasNestedSchema(right)) - Number(hasNestedSchema(left)),
  );
  const errors: string[] = [];
  for (const option of options) {
    try {
      const value = build(option, stack);
      if (schema.safeParse(value).success) return value;
      errors.push('option parsed its member but not the union');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join(' | '));
}

function fillMissing(schema: Schema, value: unknown): unknown {
  if (defOf(schema).type !== 'object' || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const shape = (schema as z.ZodObject).shape as Record<string, Schema>;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [key, field] of Object.entries(shape)) {
    if (out[key] !== undefined) continue;
    let current = field;
    while (['optional', 'default', 'prefault'].includes(defOf(current).type) && defOf(current).innerType) {
      current = defOf(current).innerType as Schema;
    }
    const filled = build(current);
    if (filled !== undefined) out[key] = filled;
  }
  return out;
}

export function validSample(schema: Schema): unknown {
  const value = defOf(schema).type === 'union' ? unionSample(schema, []) : build(schema);
  if (schema.safeParse(value).success) return value;
  const filled = fillMissing(schema, value);
  const parsed = schema.safeParse(filled);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`${schema.meta()?.id ?? defOf(schema).type}: ${issues}`);
  }
  return filled;
}

export function inject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inject);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = { __unknown: true };
    for (const [key, innerValue] of Object.entries(value as Record<string, unknown>)) out[key] = inject(innerValue);
    return out;
  }
  return value;
}

export function hasUnknown(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnknown);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '__unknown' in record || Object.values(record).some(hasUnknown);
  }
  return false;
}

export function hasNestedValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => item !== null && typeof item === 'object');
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(
      (item) => item !== null && typeof item === 'object' && !Array.isArray(item) || Array.isArray(item) && hasNestedValue(item),
    );
  }
  return false;
}
