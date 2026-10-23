import {
  validateParameters,
  type SafeParameter,
  type TemplateDefinition,
  type TemplateParameter,
} from '../templates/definition.ts';

/** نص الإشعار في لغة واحدة: العنوان اللي بيشوفه الموظف والجسم. */
export interface PushTemplateCopy {
  readonly title: string;
  readonly body: string;
}

/** تعريف قالب الدفع: مفتاحه ومراجعته ومعاملاته المسموحة ونصوصه بالعربي والإنجليزي. */
export interface PushTemplateDefinition {
  readonly key: string;
  readonly revision: number;
  readonly parameters: readonly TemplateParameter[];
  readonly copy: Readonly<Record<'ar' | 'en', PushTemplateCopy>>;
}

// اسم الفرع ممكن ييجي فاضي؛ فاضي مش خطأ، ومعناه إننا نستخدم الاسم باللغة التانية أو اللفظ العام.
const BLANK_ALLOWED = new Set(['branch_name_ar', 'branch_name_en']);

// اللفظ العام لما اسم الفرع ناقص باللغة المطلوبة وفي اللغة التانية كمان (ADR-0037 قرار 4).
const GENERIC_BRANCH: Readonly<Record<'ar' | 'en', string>> = {
  ar: 'الفرع',
  en: 'the branch',
};

const SHIFT_NOT_CLOCKED_IN_SELF: PushTemplateDefinition = {
  key: 'shift_not_clocked_in_self',
  revision: 1,
  parameters: [
    { name: 'shift_start', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
    {
      name: 'branch_name_ar',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
    {
      name: 'branch_name_en',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      textKind: 'display_name',
    },
  ],
  copy: {
    ar: {
      title: 'بصمة الحضور',
      body: 'لسه مفيش بصمة حضور ليك لشيفت الساعة {shift_start} في {branch_name}.',
    },
    en: {
      title: 'Clock-in',
      body: 'No clock-in yet for your {shift_start} shift at {branch_name}.',
    },
  },
};

// كل قوالب الدفع المعروفة؛ قالب واحد لحد ما ييجي قالب تاني.
const PUSH_TEMPLATES: readonly PushTemplateDefinition[] = [SHIFT_NOT_CLOCKED_IN_SELF];

const find = (key: string): PushTemplateDefinition | null =>
  PUSH_TEMPLATES.find((definition) => definition.key === key) ?? null;

// قالب الدفع بيشارك قواعد الأمان بتاعة قوالب الإشعارات، فبنلفّه في نفس الشكل.
const asTemplateDefinition = (definition: PushTemplateDefinition): TemplateDefinition => ({
  key: definition.key,
  revision: definition.revision,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: definition.parameters,
  copy: { ar: definition.copy.ar.body, en: definition.copy.en.body },
});

const valueOf = (parameters: readonly SafeParameter[], name: string): string | null => {
  const parameter = parameters.find((item) => item.name === name);
  if (parameter === undefined || typeof parameter.value !== 'string') return null;
  return parameter.value;
};

const branchName = (parameters: readonly SafeParameter[], locale: 'ar' | 'en'): string => {
  const own = valueOf(parameters, locale === 'ar' ? 'branch_name_ar' : 'branch_name_en');
  if (own !== null && own.trim() !== '') return own;
  const other = valueOf(parameters, locale === 'ar' ? 'branch_name_en' : 'branch_name_ar');
  if (other !== null && other.trim() !== '') return other;
  return GENERIC_BRANCH[locale];
};

const matches = (
  definition: PushTemplateDefinition,
  parameters: readonly SafeParameter[],
): boolean => {
  if (parameters.length !== definition.parameters.length) return false;
  const normalized: SafeParameter[] = [];
  for (const [index, descriptor] of definition.parameters.entries()) {
    const parameter = parameters[index];
    if (parameter === undefined) return false;
    const blank =
      BLANK_ALLOWED.has(descriptor.name) &&
      typeof parameter.value === 'string' &&
      parameter.value.trim() === '';
    normalized.push(blank ? { ...parameter, value: GENERIC_BRANCH.ar } : parameter);
  }
  return validateParameters(asTemplateDefinition(definition), 'ar', normalized);
};

/**
 * بيتأكد إن القالب ومراجعته ومعاملاته مطابقة لقالب دفع معروف.
 * القاعدة: الاسم الفاضي مسموح (فيُستبدل وقت العرض)، وأي قيمة تانية اسمها رابط أو هاتف أو رمز بتترفض.
 *
 * @param key        مفتاح القالب
 * @param revision   مراجعة القالب
 * @param parameters المعاملات الآمنة المرتبة
 * @returns true لو القالب معروف ومعاملاته مطابقة
 */
export function validPushTemplate(
  key: string,
  revision: number,
  parameters: readonly SafeParameter[],
): boolean {
  const definition = find(key);
  if (definition === null || definition.revision !== revision) return false;
  return matches(definition, parameters);
}

/**
 * بيرسم نص الإشعار بلغة الاشتراك.
 * القاعدة: اسم الفرع بلغة الإشعار، ولما ينقص بنستخدم الاسم باللغة التانية، ولما ينقص الاتنين بنستخدم اللفظ العام.
 *
 * @param key        مفتاح القالب
 * @param revision   مراجعة القالب
 * @param locale     لغة الاشتراك
 * @param parameters المعاملات الآمنة المرتبة
 * @returns العنوان والجسم، أو null لو القالب مش معروف أو المعاملات مرفوضة
 */
export function renderPushNotice(
  key: string,
  revision: number,
  locale: 'ar' | 'en',
  parameters: readonly SafeParameter[],
): PushTemplateCopy | null {
  const definition = find(key);
  if (definition === null || definition.revision !== revision) return null;
  if (!matches(definition, parameters)) return null;
  const copy = definition.copy[locale];
  const values: Record<string, string> = {
    shift_start: valueOf(parameters, 'shift_start') ?? '',
    branch_name: branchName(parameters, locale),
  };
  return {
    title: copy.title,
    body: copy.body.replace(
      /\{(shift_start|branch_name)\}/g,
      (_match, name: string) => values[name] ?? '',
    ),
  };
}
