/**
 * يطابق عدادات Turbo مع نتائج المهام؛ الكاش منفصل عن النجاح، ورمز HIT الغائب ليس فشلاً.
 */
export function outcomesMatch(tasks, { attempted, cached, failed, succeeded, exitCode }) {
  const hits = tasks.filter((task) => task.cacheStatus === 'HIT');
  const executed = tasks.filter((task) => task.cacheStatus !== 'HIT');
  return (
    (failed === 0 || exitCode !== 0) &&
    cached + failed + succeeded === attempted &&
    cached === hits.length &&
    succeeded === executed.filter((task) => task.exitCode === 0).length &&
    failed === executed.filter((task) => task.exitCode !== null && task.exitCode !== 0).length &&
    hits.every((task) => task.exitCode === null || task.exitCode === 0)
  );
}
