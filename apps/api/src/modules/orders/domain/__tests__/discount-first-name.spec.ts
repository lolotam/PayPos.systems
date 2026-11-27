import { describe, expect, it } from 'vitest';
import { firstName, optionalFirstName } from '../discount-first-name.ts';

const CASES: [string, string, string][] = [
  ['one word', 'Noura', 'Noura'],
  ['several words', 'Noura Ahmed', 'Noura'],
  ['a tab between the words', 'Noura\tAhmed', 'Noura'],
  ['a new line between the words', 'Noura\nAhmed', 'Noura'],
  ['a non-breaking space between the words', 'Noura\u00a0Ahmed', 'Noura'],
  ['another Zs space between the words', 'Noura\u2003Ahmed', 'Noura'],
  ['a byte order mark before the words', '\ufeffNoura Ahmed', 'Noura'],
  ['leading and trailing whitespace', '  Noura Ahmed  ', 'Noura'],
  ['a mixed run of whitespace', ' Noura \t \u00a0 Ahmed ', 'Noura'],
  ['a two-word Arabic name', 'نورة أحمد', 'نورة'],
  ['an Arabic name with a tab', 'نورة\tأحمد', 'نورة'],
  ['the empty string', '', '—'],
];

describe('the first name cut of a label', () => {
  it.each(CASES)('cuts %s', (_label, name, expected) => {
    expect(firstName(name)).toBe(expected);
  });

  it('falls back to one dash when the name has no word at all', () => {
    expect(firstName('   ')).toBe('—');
    expect(firstName('\u00a0\ufeff\t')).toBe('—');
    expect(firstName('\u200b\u200d\u2060')).toBe('—');
  });
});

describe('the compound Arabic name', () => {
  it('keeps the prefix with the word that follows it', () => {
    expect(firstName('عبد الله محمد')).toBe('عبد الله');
    expect(firstName('عبد الرحمن الشمري')).toBe('عبد الرحمن');
    expect(firstName('أبو بكر الصديق')).toBe('أبو بكر');
    expect(firstName('أبى بكر الصديق')).toBe('أبى بكر');
    expect(firstName('أبو سالم')).toBe('أبو سالم');
    expect(firstName('أم كلثوم إبراهيم')).toBe('أم كلثوم');
    expect(firstName('ابن سينا')).toBe('ابن سينا');
    expect(firstName('بنت الشاطئ')).toBe('بنت الشاطئ');
    expect(firstName('ذو الفقار علي')).toBe('ذو الفقار');
    expect(firstName('آل سعود')).toBe('آل سعود');
  });

  it('keeps the suffix with the word that precedes it', () => {
    expect(firstName('نور الدين محمود')).toBe('نور الدين');
    expect(firstName('نور الهدى محمد')).toBe('نور الهدى');
    expect(firstName('صلاح الدين الأيوبي')).toBe('صلاح الدين');
    expect(firstName('هبة الله أحمد')).toBe('هبة الله');
    expect(firstName('منة الله سعيد')).toBe('منة الله');
    expect(firstName('سيف الإسلام')).toBe('سيف الإسلام');
    expect(firstName('نصر الحق علي')).toBe('نصر الحق');
    expect(firstName('شمس الرحمن سالم')).toBe('شمس الرحمن');
  });

  it('reads the shaped name as the plain one, and keeps the shape in the snapshot', () => {
    expect(firstName('عَبْدُ اللَّهِ صالح')).toBe('عَبْدُ اللَّهِ');
    expect(firstName('أبو بكر')).toBe('أبو بكر');
    expect(firstName('نُورُ الدِّين')).toBe('نُورُ الدِّين');
  });

  it('leaves a name that is not compound with its first word', () => {
    expect(firstName('محمد علي')).toBe('محمد');
    expect(firstName('Sara Performer')).toBe('Sara');
    expect(firstName('عبد')).toBe('عبد');
    expect(firstName('الله')).toBe('الله');
  });
});

describe('the name that is too long', () => {
  it('is cut to the length the column takes', () => {
    const long = 'ع'.repeat(250);
    expect(firstName(`${long} ب`)).toHaveLength(200);
    expect(firstName(`عبد ${long}`)).toBe('عبد');
  });
});

describe('the optional name', () => {
  it('stays empty when there is nothing to cut', () => {
    expect(optionalFirstName(null)).toBeNull();
    expect(optionalFirstName('')).toBeNull();
    expect(optionalFirstName('   ')).toBeNull();
    expect(optionalFirstName('\u00a0')).toBeNull();
    expect(optionalFirstName('\u200b')).toBeNull();
  });

  it('cuts the name when it carries a word', () => {
    expect(optionalFirstName('عبد الله سالم')).toBe('عبد الله');
    expect(optionalFirstName('سارة')).toBe('سارة');
    expect(optionalFirstName('Sara Performer')).toBe('Sara');
  });
});
