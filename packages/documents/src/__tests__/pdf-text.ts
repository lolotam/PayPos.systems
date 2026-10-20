import { inflateRawSync, inflateSync } from 'node:zlib';

function inflate(data: Buffer): string {
  const parts: string[] = [];
  for (const slice of [data, data.subarray(0, Math.max(0, data.length - 1)), data.subarray(2)]) {
    for (const decode of [inflateSync, inflateRawSync]) {
      try {
        parts.push(decode(slice).toString('latin1'));
      } catch {
        // not a flate stream
      }
    }
  }
  return parts.join('\n');
}

function streams(raw: string): string[] {
  const found: string[] = [];
  const marked = /\/Length\s+(\d+)[\s\S]*?stream\r?\n/g;
  for (const match of raw.matchAll(marked)) {
    const length = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    found.push(inflate(Buffer.from(raw.slice(start, start + length), 'latin1')));
  }
  return found;
}

function utf16Hex(input: string): string {
  return input.replace(/<([0-9A-Fa-f\s]+)>/g, (_full, hex: string) => {
    const cleaned = hex.replace(/[^0-9A-Fa-f]/g, '');
    if (cleaned.length < 4 || cleaned.length % 4 !== 0) return '';
    return Buffer.from(cleaned, 'hex').swap16().toString('utf16le');
  });
}

function utf16Binary(latin: string): string {
  const even = latin.length - (latin.length % 2);
  const buffer = Buffer.from(latin.slice(0, even), 'latin1');
  const swapped = Buffer.from(buffer).swap16();
  return `${buffer.toString('utf16le')}\n${swapped.toString('utf16le')}`;
}

function utf16be(hex: string): string {
  const cleaned = hex.replace(/[^0-9A-Fa-f]/g, '');
  if (cleaned.length < 4 || cleaned.length % 4 !== 0) return '';
  return Buffer.from(cleaned, 'hex').swap16().toString('utf16le');
}

function addRange(map: Map<number, string>, start: number, end: number, destHex: string): void {
  const first = utf16be(destHex);
  const base = first.codePointAt(0);
  if (base === undefined || [...first].length !== 1) return;
  const last = Math.min(end, start + 255);
  for (let code = start; code <= last; code += 1) {
    map.set(code, String.fromCodePoint(base + (code - start)));
  }
}

function mergeCmap(map: Map<number, string>, text: string): void {
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const glyph = utf16be(pair[2] ?? '');
      if (glyph) map.set(Number.parseInt(pair[1] ?? '', 16), glyph);
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of (block[1] ?? '').matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      addRange(
        map,
        Number.parseInt(range[1] ?? '', 16),
        Number.parseInt(range[2] ?? '', 16),
        range[3] ?? '',
      );
    }
  }
}

function cidStep(text: string): number {
  const range = /begincodespacerange[\s\S]*?<([0-9A-Fa-f]+)>/.exec(text);
  return Math.max(4, (range?.[1] ?? '0000').length);
}

function showText(text: string, map: Map<number, string>, step: number): string {
  const words: string[] = [];
  for (const match of text.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const hex = (match[1] ?? '').replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length === 0 || hex.length % step !== 0) continue;
    let word = '';
    for (let index = 0; index < hex.length; index += step) {
      word += map.get(Number.parseInt(hex.slice(index, index + step), 16)) ?? '';
    }
    if (word) words.push(word);
  }
  return words.join('');
}

/** كروميوم بيرسم الحروف كـ CID؛ الاسم الأصلي بيرجع من ToUnicode مش من البايتات الخام. */
function paintedText(parts: readonly string[]): string {
  const map = new Map<number, string>();
  let step = 4;
  const contents: string[] = [];
  for (const text of parts) {
    if (text.includes('beginbfchar') || text.includes('beginbfrange')) {
      mergeCmap(map, text);
      step = cidStep(text);
    }
    if (/\bTj\b|\bTJ\b/.test(text)) contents.push(text);
  }
  return contents.map((text) => showText(text, map, step)).join('\n');
}

/** نص تقريبي من تيارات PDF المضغوطة. الاختبار بيفشل لو العلامة الأصلية مش ظاهرة. */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const inflated = streams(raw);
  const joined = inflated.join('\n');
  return [
    raw,
    joined,
    utf16Binary(joined),
    utf16Hex(raw),
    utf16Hex(joined),
    paintedText(inflated),
  ].join('\n');
}
