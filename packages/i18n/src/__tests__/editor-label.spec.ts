import { describe, expect, it } from 'vitest';
import { editorLabel, type EditorLabelSnapshot } from '../editor-label.js';

const base: EditorLabelSnapshot = {
  nameAr: null,
  nameEn: null,
  role: 'owner',
  roleIsSystem: true,
  roleNameAr: 'المالك',
  roleNameEn: 'Owner',
};
const label = (patch: Partial<EditorLabelSnapshot>) => ({
  ar: editorLabel('ar', { ...base, ...patch }),
  en: editorLabel('en', { ...base, ...patch }),
});

describe('editorLabel: employee name first', () => {
  it('uses the Arabic name for Arabic and the English name for English', () => {
    expect(label({ nameAr: 'منى', nameEn: 'Mona' })).toEqual({ ar: 'منى', en: 'Mona' });
  });
  it('falls back to the English name for Arabic, never the reverse', () => {
    expect(label({ nameAr: null, nameEn: 'Mona' })).toEqual({ ar: 'Mona', en: 'Mona' });
    expect(label({ nameAr: 'منى', nameEn: null }).en).toBe('Owner');
  });
});

describe('editorLabel: role when there is no employee name (LE-22)', () => {
  it('shows the owner and the three manager roles with the answered ED-Q13 wording', () => {
    expect(label({ role: 'owner' })).toEqual({ ar: 'المالك', en: 'Owner' });
    for (const role of ['general_manager', 'business_manager', 'branch_manager'])
      expect(label({ role })).toEqual({ ar: 'المدير', en: 'Manager' });
  });
  it('shows other system roles with the approved role names', () => {
    expect(label({ role: 'accountant' })).toEqual({ ar: 'محاسب', en: 'Accountant' });
    expect(label({ role: 'cashier' }).ar).toBe('كاشير');
  });
  it('shows a company role with its own stored name, even when its code equals a system role', () => {
    const company = { role: 'cashier', roleIsSystem: false, roleNameAr: 'أمينة الصندوق', roleNameEn: 'Till lead' };
    expect(label(company)).toEqual({ ar: 'أمينة الصندوق', en: 'Till lead' });
    expect(label({ ...company, roleNameAr: null })).toEqual({ ar: 'Till lead', en: 'Till lead' });
  });
  it('reads rows written before the role snapshot: owner and manager still map', () => {
    expect(label({ role: 'manager', roleIsSystem: null, roleNameAr: null, roleNameEn: null })).toEqual({
      ar: 'المدير',
      en: 'Manager',
    });
  });
});

describe('editorLabel: generic labels', () => {
  it('uses the generic user label when a company role name is unsafe', () => {
    const unsafe = { role: 'x', roleIsSystem: false, roleNameAr: null, roleNameEn: 'https://example.test' };
    expect(label(unsafe)).toEqual({ ar: 'مستخدم', en: 'User' });
  });
  it('uses the generic employee label when a stored name is unsafe and no role is usable', () => {
    const unsafe = { nameEn: '12345678', role: null, roleIsSystem: null, roleNameAr: null, roleNameEn: null };
    expect(label(unsafe)).toEqual({ ar: 'موظف', en: 'Employee' });
  });
  it('prefers the role over the generic employee label when only the name is unsafe', () => {
    expect(label({ nameEn: 'https://example.test', role: 'branch_manager' })).toEqual({ ar: 'المدير', en: 'Manager' });
  });
});
