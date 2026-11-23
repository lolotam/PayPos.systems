// الخطأ اللي سببه حالة الإحصاءات وحدها: إلغاء الجملة بمهلة الخادم (57014) أو انتهاء مهلة المعاملة، وده الوحيد اللي تُرفض بسببه
// محاولة القياس وتتعاد على شركة جديدة. أي خطأ تاني (مقارنة الصفحة بالمرجع، شكل النتيجة، عدد الجمل، أو عطل غير متوقع) فشل حقيقي
// للاختبار لازم يطلع زي ما هو مهما اتغيّرت الإحصاءات، فمفيش إعادة محاولة تخفيه.
export function isStatisticsDependentFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current.name === 'TimeoutError') return true;
    if ((current as { code?: unknown }).code === '57014') return true;
    current = current.cause;
  }
  return false;
}
