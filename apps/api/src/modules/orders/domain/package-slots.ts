/** واجهة توافق للجلسات وقيمها؛ التنفيذ المشترك يحافظ على نفس قواعد البيع والاستيراد. */
export { type PackageSlotState, type PackageSlot, type PackageRefundSelection, createPackageSlots, selectPackageRedemptionSlot, selectPackageRefundSlots, canReversePackageRedemption } from '@pospay/domain';
