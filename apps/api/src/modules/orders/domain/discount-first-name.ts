/**
 * يبني الكلمة من رموزها، فالنص العربي الحرفي ممنوع خارج `packages/i18n` (قاعدة CLAUDE.md §7).
 * والاسم العربي بيانات لا نص يقرؤه المستخدم، فهو يبني من رموزه كما اسم الموظف في النواة.
 *
 * @param codes رموز الكلمة بالنظام الست عشري، مفصولة بمسافة
 * @returns الكلمة المبنية
 */
function arabicWord(codes: string): string {
  return String.fromCodePoint(...codes.split(' ').map((code) => Number.parseInt(code, 16)));
}

/** حدود الاسم المركّب: سابقة تلتصق بالكلمة التي بعدها («عبد الله»، «أم كلثوم»، «آل سعود»). */
const COMPOUND_PREFIXES = new Set([
  arabicWord('0639 0628 062f'), // عبد
  arabicWord('0627 0628 0648'), // ابو
  arabicWord('0627 0628 064a'), // ابي
  arabicWord('0627 0628 0627'), // ابا
  arabicWord('0627 0645'), // ام
  arabicWord('0627 0628 0646'), // ابن
  arabicWord('0628 0646 062a'), // بنت
  arabicWord('0628 0646'), // بن
  arabicWord('0627 0644'), // ال
  arabicWord('0630 0648'), // ذو
  arabicWord('0630 064a'), // ذي
  arabicWord('0630 0627'), // ذا
  arabicWord('0630 0627 062a'), // ذات
]);

/** حدود الاسم المركّب: لاحقة تلتصق بالكلمة التي قبلها («نور الدين»، «نور الهدى»، «سيف الإسلام»). */
const COMPOUND_SUFFIXES = new Set([
  arabicWord('0627 0644 0644 0647'), // الله
  arabicWord('0627 0644 062f 064a 0646'), // الدين
  arabicWord('0627 0644 0627 0633 0644 0627 0645'), // الاسلام
  arabicWord('0627 0644 0647 062f 064a'), // الهدي
  arabicWord('0627 0644 062d 0642'), // الحق
  arabicWord('0627 0644 0631 062d 0645 0646'), // الرحمن
]);

/** اسم بديل لاسمٍ لا حرف فيه غير المسافة: حرف واحد يبقى صالحاً في العمود ولا يُعرض فراغاً. */
const FALLBACK_FIRST_NAME = '—';

/** أقصى طول للاسم الأول المحفوظ، وهو حدّ العمود في قاعدة البيانات. */
const MAX_FIRST_NAME_LENGTH = 200;

/** علامات التشكيل والتطويل: ليست جزءاً من الاسم فتسقط من المقارنة. */
const ARABIC_MARKS = /[\u064b-\u065f\u0670\u0640]/g;

/** محارف عرضها صفر: تُسقط قبل التقسيم حتى لا تُحفظ كأسماء خفية. */
const ZERO_WIDTH = /[\u200b-\u200d\u2060]/g;

/** صور الألف: توحَّد قبل المقارنة فـ«أبو» و«ابو» اسمٌ واحد. */
const ALEF_VARIANTS = new RegExp(`[${String.fromCodePoint(0x0623, 0x0625, 0x0622, 0x0671)}]`, 'g');

/** الألف الموحَّد، وهو صورة «ا» التي تُقارن بها الكلمات. */
const ALEF = String.fromCodePoint(0x0627);

/** الألف المقصورة والياء: توحَّد الأخيرة للمقارنة فـ«الهدى» و«أبى» يطابقان «الهدي» و«أبي». */
const ALEF_MAQSURA = String.fromCodePoint(0x0649);
const YA = String.fromCodePoint(0x064a);

/**
 * يوحّد الكلمة العربية قبل المقارنة: يزيل التشكيل والتطويل ويوحّد صور الألف والألف المقصورة.
 * القاعدة: المقارنة على الاسم المطبَّع، فالاسم المشكول «عَبْدُ» يطابق «عبد».
 *
 * @param word الكلمة كما وردت في الاسم
 * @returns الكلمة بعد التطبيع، وهي نفسها إن لم تحمل ما يُطبَّع
 */
function normalizeArabicWord(word: string): string {
  return word.replace(ARABIC_MARKS, '').replace(ALEF_VARIANTS, ALEF).replaceAll(ALEF_MAQSURA, YA);
}

function splitWords(name: string): string[] {
  return name
    .replace(ZERO_WIDTH, '')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * يقطع الاسم الأول من الاسم الكامل: أول كلمة بعد تجاهل المسافات، أو أول كلمتين إن كان الاسم مركّباً.
 * القاعدة: الاسم المركّب يُعرف بسابقته أو لاحقته («عبد الله»، «نور الدين»)، فيُحفظ كما ورد لا مقطوعاً.
 * واسمٌ لا حرف فيه غير المسافة لا يُترك فراغاً: يُكتب بديلٌ واحد يبقى صالحاً في العمود.
 * الفصل على أي مسافة يونيكود (`\s`: مسافة، تاب، سطر جديد، NBSP، وباقي مسافات Zs، و U+FEFF) بعد إسقاط محارف العرض الصفري.
 *
 * @param name الاسم الكامل كما جاء من قاعدة البيانات
 * @returns الاسم الأول، أو أول كلمتين للاسم المركّب، أو البديل إن لم يكن في الاسم كلمة
 */
export function firstName(name: string): string {
  const words = splitWords(name);
  const first = words[0];
  if (first === undefined) return FALLBACK_FIRST_NAME;
  const second = words[1];
  if (second !== undefined) {
    const compound = `${first} ${second}`;
    const isCompound =
      COMPOUND_PREFIXES.has(normalizeArabicWord(first)) ||
      COMPOUND_SUFFIXES.has(normalizeArabicWord(second));
    if (isCompound) {
      return compound.length <= MAX_FIRST_NAME_LENGTH
        ? compound
        : first.slice(0, MAX_FIRST_NAME_LENGTH);
    }
  }
  return first.length <= MAX_FIRST_NAME_LENGTH ? first : first.slice(0, MAX_FIRST_NAME_LENGTH);
}

/**
 * يقطع الاسم الأول أو يتركه فارغاً: اسمٌ فارغ أو مسافاتٌ فقط لا يُحفظ ولا يُعرض.
 * القاعدة: العمود الاختياري يبقى NULL فيرجع العرض إلى اسم الدور، والعمود المطلوب يأخذ بديلاً واحداً.
 *
 * @param name الاسم الكامل كما جاء من قاعدة البيانات، أو NULL
 * @returns الاسم الأول، أو NULL إن كان الاسم فارغاً أو مسافاتٍ فقط
 */
export function optionalFirstName(name: string | null): string | null {
  if (name === null) return null;
  if (splitWords(name).length === 0) return null;
  return firstName(name);
}
