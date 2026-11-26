// كود المطابقة بين شاشة المدير وشاشة انتظار الجهاز (spec 071): الحساب الوحيد في @pospay/domain،
// والـ domain بتاع الموديول بيعيد تصديره عشان الـ use cases تستورده من مكانه المعتاد.

/**
 * أبجدية كود المطابقة (نفس أبجدية كود الربط، من غير الحروف المتشابهة)، معاد تصديرها من @pospay/domain.
 */
export { DEVICE_CHECK_CODE_ALPHABET, computeDeviceCheckCode } from '@pospay/domain';
