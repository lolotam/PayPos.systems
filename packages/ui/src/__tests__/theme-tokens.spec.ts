import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

// مسار الملف بيتحسب من مجلد التشغيل، عشان يتقرا من جوه vitest في أي بيئة.
const themePath = [
  resolvePath(process.cwd(), 'src/styles/theme.css'),
  resolvePath(process.cwd(), 'packages/ui/src/styles/theme.css'),
].find((candidate) => existsSync(candidate));

if (!themePath) throw new Error('ملف theme.css اتشال من مكانه');

const themeCss = readFileSync(themePath, 'utf8');

type Declarations = Map<string, string>;

/** بيقسّم ملف CSS لبلوكات على المستوى الأعلى، بعد ما التعليقات تتشال. */
function topLevelBlocks(css: string): { selector: string; body: string }[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: { selector: string; body: string }[] = [];
  let index = 0;
  while (index < withoutComments.length) {
    const open = withoutComments.indexOf('{', index);
    if (open === -1) break;
    const close = withoutComments.indexOf('}', open);
    if (close === -1) break;
    const raw = withoutComments.slice(index, open);
    blocks.push({
      selector: raw.slice(raw.lastIndexOf('}') + 1).trim(),
      body: withoutComments.slice(open + 1, close),
    });
    index = close + 1;
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

/** بيجمع كل بلوكات محدد معيّن، زي :root اللي بيتكرر أكتر من مرة. */
function scope(selector: string): Declarations {
  const merged: Declarations = new Map();
  for (const block of topLevelBlocks(themeCss)) {
    if (block.selector !== selector) continue;
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

describe('لوحة ألوان الشارات', () => {
  it('نص شارة المعلومات بيفضل مقروء فوق خلفيتها في الوضعين الفاتح والداكن', () => {
    const lightContrast = contrastRatio(
      resolve('--info', light, light),
      resolve('--status-foreground', light, light),
    );
    const darkContrast = contrastRatio(
      resolve('--info', dark, light),
      resolve('--status-foreground', dark, light),
    );
    expect(lightContrast).toBeGreaterThanOrEqual(4.5);
    expect(darkContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('لون المعلومات بيتغمق في الوضع الفاتح بس، والوضع الداكن بيفضل زي chart-5', () => {
    expect(resolve('--info', light, light)).not.toBe(resolve('--chart-5', light, light));
    expect(resolve('--info', dark, light)).toBe(resolve('--chart-5', dark, light));
  });
});
