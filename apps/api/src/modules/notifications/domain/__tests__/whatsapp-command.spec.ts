import { describe, expect, it } from 'vitest';
import { classifyWhatsappCommand } from '../whatsapp-command.ts';

describe('owner-approved whole-message STOP vocabulary', () => {
  it.each([
    'STOP',
    'stop',
    ' \nStOp\t',
    'ＳＴＯＰ',
    'UNSUBSCRIBE',
    'unsubscribe',
    'إيقاف',
    'ايقاف',
    'توقف',
  ])('accepts %s', (text) => {
    expect(classifyWhatsappCommand('text', text, undefined, 'test-stop')).toBe('STOP');
  });
  it.each([
    'UNSUBSCR\u0131BE',
    'CANCEL',
    'إلغاء',
    'الغاء',
    'START',
    'please STOP',
    'STOP now',
    '"STOP"',
    'توقف الآن',
    'STOP!',
    '',
  ])('excludes %s', (text) => {
    expect(classifyWhatsappCommand('text', text, undefined, 'test-stop')).toBe('OTHER');
  });
  it('accepts approved button id only and never a title/media/quote', () => {
    expect(classifyWhatsappCommand('button', undefined, 'test-stop', 'test-stop')).toBe('STOP');
    expect(classifyWhatsappCommand('interactive', undefined, 'test-stop', 'test-stop')).toBe(
      'STOP',
    );
    expect(classifyWhatsappCommand('button', 'STOP', 'unknown', 'test-stop')).toBe('OTHER');
    expect(classifyWhatsappCommand('image', 'STOP', undefined, 'test-stop')).toBe('OTHER');
    expect(classifyWhatsappCommand('button', undefined, 'test-stop', undefined)).toBe('OTHER');
  });
});
