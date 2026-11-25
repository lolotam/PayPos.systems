import { deriveEmployeeCardKey } from '@pospay/auth';

/**
 * مفتاح كروت الحضور وبصمة الهاتف في اختبارات الـ API — مشتق من سر اختبار ثابت. نفس المفتاح
 * بيتبعت للتركيب وبيتبني بيه أي اختبار يبني خطوات إدخال الدخول بنفسه، فتبصمة الهاتف
 * متطابقة في المسارين ومفيش رفض زائف عند الاستئناف.
 */
export const testEmployeeCardKey = deriveEmployeeCardKey('test-secret-that-is-long-enough-for-hmac');
