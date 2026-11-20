import { readFileSync } from 'node:fs';
// بنستخدم URL بتاعة node:url ومسمّيتها NodeURL: الـ URL العالمية في بيئة jsdom بتحسب المسار النسبي على أساس
// المستند، وVite بيحوّل المسار اللي شكله new URL('...', import.meta.url) لعنوان السيرفر.
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_COLORS } from '../theme.js';

// الملف بيتقرأ من مساره جوّه الحزمة، عشان يتقرا من غير ما نكون شايفين على مجلد التشغيل.
const themePath = fileURLToPath(new NodeURL('../styles/theme.css', import.meta.url));
const themeCss = readFileSync(themePath, 'utf8');

type Declarations = Map<string, string>;

/** بيقسّم ملف CSS لبلوكات على المستوى الأعلى بعد ما التعليقات تتشال، بعدّ الأقواس عشان البلوكات المتداخلة ما تقراش خطأ. */
function topLevelBlocks(css: string): { selector: string; body: string }[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: { selector: string; body: string }[] = [];
  let depth = 0;
  let blockStart = -1;
  let selectorStart = 0;
  let selector = '';
  let index = 0;
  while (index < withoutComments.length) {
    const character = withoutComments[index];
    if (character === '{') {
      if (depth === 0) {
        blockStart = index + 1;
        selector = withoutComments.slice(selectorStart, index).trim();
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && blockStart !== -1) {
        blocks.push({ selector, body: withoutComments.slice(blockStart, index) });
        blockStart = -1;
        selectorStart = index + 1;
      }
    }
    index += 1;
  }
  return blocks;
}

function declarationsOf(body: string): Declarations {
  const declarations: Declarations = new Map();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = match[1];
    const value = match[2];
    if (name && value) declarations.set(name, value.trim());
  }
  return declarations;
}

/** بيجمع كل بلوكات محدد معيّن، وبيقبل المحدد المركّب زي ":root, .dark". */
function scope(selector: string): Declarations {
  const merged: Declarations = new Map();
  for (const block of topLevelBlocks(themeCss)) {
    const selectors = block.selector.split(',').map((part) => part.trim());
    if (!selectors.includes(selector)) continue;
    for (const [name, value] of declarationsOf(block.body)) merged.set(name, value);
  }
  return merged;
}

/** بيحل الرموز المتسلسلة زي var(--background) جوه النطاق المطلوب. */
function resolve(name: string, scopeMap: Declarations, baseMap: Declarations): string {
  const raw = scopeMap.get(name) ?? baseMap.get(name) ?? '';
  const referenced = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw)?.[1];
  if (!referenced) return raw;
  return resolve(referenced, scopeMap, baseMap);
}

function toRgb(value: string): [number, number, number] {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!match) throw new Error(`التوكن ده مش مدعوم: ${value}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const long = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const medium = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const short = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = long ** 3;
  const m = medium ** 3;
  const s = short ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) =>
    Math.round(
      Math.min(
        1,
        Math.max(0, channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055),
      ) * 255,
    ),
  );
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`التوكن ده مش مدعوم: ${value}`);
  }
  return [red, green, blue];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linearise = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue);
}

function contrastRatio(background: string, foreground: string): number {
  const first = relativeLuminance(toRgb(background));
  const second = relativeLuminance(toRgb(foreground));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const light = scope(':root');
const dark = scope('.dark');

/** قيم الـ html المحسوبة في الوضع الفاتح: التوكن بيحسب في النطاق اللي بيعلنه. */
const rootComputed = new Map<string, string>();
for (const name of light.keys()) rootComputed.set(name, resolve(name, light, light));

/** قيم عنصر جوّه شجرة .dark: المعلن في الشجرة بيتحسب فيها، وإلا بيرث المحسوب من الـ html. */
const subtreeScope = new Map<string, string>([...rootComputed, ...dark]);
function subtreeValue(name: string): string {
  if (!dark.has(name)) return rootComputed.get(name) ?? '';
  return resolve(name, subtreeScope, rootComputed);
}

/** خلفيات الشارات اللي النص بيتقرا فوقها بـ --status-foreground. */
const STATUS_BACKGROUNDS = [
  { name: 'معلومات', token: '--info' },
  { name: 'وردية مفتوحة', token: '--open-shift' },
  { name: 'مدفوع', token: '--paid' },
  { name: 'نجاح', token: '--success' },
  { name: 'معلّق', token: '--pending' },
  { name: 'تحذير', token: '--warning' },
  { name: 'فشل', token: '--failed' },
  { name: 'مخزون ضعيف', token: '--low-stock' },
];

describe('لوحة ألوان الشارات', () => {
  it('كتلتا :root و.dark موجودتين في theme.css', () => {
    expect(light.size).toBeGreaterThan(0);
    expect(dark.size).toBeGreaterThan(0);
  });

  for (const { name, token } of STATUS_BACKGROUNDS) {
    it(`نص شارة ${name} بيفضل مقروء فوق خلفيتها في الوضعين الفاتح والداكن`, () => {
      const lightContrast = contrastRatio(
        resolve(token, light, light),
        resolve('--status-foreground', light, light),
      );
      const darkContrast = contrastRatio(
        resolve(token, dark, light),
        resolve('--status-foreground', dark, light),
      );
      expect(lightContrast).toBeGreaterThanOrEqual(4.5);
      expect(darkContrast).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('لون المعلومات بيتغمق في الوضع الفاتح بس، والوضع الداكن بيفضل زي chart-5', () => {
    expect(resolve('--info', light, light)).not.toBe(resolve('--chart-5', light, light));
    expect(resolve('--info', dark, light)).toBe(resolve('--chart-5', dark, light));
  });

  it('لون المخزون الضعيف مختلف عن المعلّق في الوضعين، عشان الشارتين ماتبحطّوش في نفس اللون', () => {
    expect(resolve('--low-stock', light, light)).not.toBe(resolve('--pending', light, light));
    expect(resolve('--low-stock', dark, light)).not.toBe(resolve('--pending', dark, light));
  });

  it('الأسماء البديلة بتتحسب جوّه شجرة .dark زي ما بتتحسب على الـ html', () => {
    expect(subtreeValue('--open-shift')).toBe(resolve('--chart-5', dark, light));
    expect(subtreeValue('--status-foreground')).toBe(resolve('--background', dark, light));
  });
});

// ألوان المتصفح (browserconfig وsite.webmanifest) بتنسخ قيمها يدويًا من theme.css،
// فالتزامن مع THEME_COLORS مش مضمون بالبناء: الاختبار ده بيمسك أي انزلاق في تحويل oklch
// أو أي تعديل لون اتعمل في ملف منهم من غير التاني.
describe('browser theme colours', () => {
  /** بيقرا ملف من المستودع بمسار نسبي من الجذر: الجذر أبعد بأربعة مستويات عن packages/ui/src/__tests__. */
  function repoFile(relativePath: string): string {
    return readFileSync(
      fileURLToPath(new NodeURL(`../../../../${relativePath}`, import.meta.url)),
      'utf8',
    );
  }

  /** بيحوّل قناة RGB لخانة hex من رقمين، عشان النتيجة تطلع #RRGGBB دايمًا. */
  function toHex([red, green, blue]: [number, number, number]): string {
    const channel = (value: number) => value.toString(16).padStart(2, '0');
    return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
  }

  it('background and browser tile colours stay in sync with THEME_COLORS', () => {
    expect(toHex(toRgb(resolve('--background', light, light)))).toBe(
      THEME_COLORS.light.toUpperCase(),
    );
    expect(toHex(toRgb(resolve('--background', dark, light)))).toBe(
      THEME_COLORS.dark.toUpperCase(),
    );

    const tileColorOf = (xml: string) =>
      /<TileColor>([^<]+)<\/TileColor>/.exec(xml)?.[1]?.trim().toUpperCase();
    expect(tileColorOf(repoFile('apps/admin/public/browserconfig.xml'))).toBe(
      THEME_COLORS.light.toUpperCase(),
    );
    expect(tileColorOf(repoFile('apps/pos/public/browserconfig.xml'))).toBe(
      THEME_COLORS.light.toUpperCase(),
    );

    const manifest = JSON.parse(repoFile('apps/admin/public/site.webmanifest')) as {
      theme_color?: string;
      background_color?: string;
    };
    expect(manifest.theme_color?.toUpperCase()).toBe(THEME_COLORS.light.toUpperCase());
    expect(manifest.background_color?.toUpperCase()).toBe(THEME_COLORS.light.toUpperCase());
  });
});
