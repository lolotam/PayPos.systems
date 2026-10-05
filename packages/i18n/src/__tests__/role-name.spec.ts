import { describe, expect, it } from 'vitest';
import { roleName } from '../role-name.js';
const names = {
  owner: 'صاحب الشركة',
  general_manager: 'مدير عام',
  accountant: 'محاسب',
  business_manager: 'مدير نشاط',
  branch_manager: 'مدير فرع',
  shift_supervisor: 'مشرف وردية',
  cashier: 'كاشير',
  waiter: 'ويتر',
  kitchen: 'مطبخ',
  storekeeper: 'أمين مخزن',
  staff: 'موظف',
  marketing: 'تسويق',
  viewer: 'مشاهد',
};

describe('final tenant role names, owner decision 2026-10-03', () => {
  it.each(Object.entries(names))(
    'localizes %s without depending on seeded Arabic',
    (code, arabic) => {
      expect(roleName('ar', code, 'fallback')).toBe(arabic);
      expect(roleName('en', code, 'fallback')).not.toBe('fallback');
    },
  );
  it('preserves custom and technical role display names', () => {
    expect(roleName('ar', 'custom', 'Custom role')).toBe('Custom role');
    expect(roleName('en', 'device', 'Device')).toBe('Device');
  });
});
