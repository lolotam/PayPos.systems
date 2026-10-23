import type { LinePerformerShare } from './commission-types.ts';

/**
 * يوزع صافي البند بالفلس بأرضية كل نصيب والباقي بالهوية تصاعدياً، حتى يساوي المجموع الصافي.
 *
 * @param net الصافي غير السالب؛ قيمة slot عند خدمة من باقة
 * @param performers مؤديات بهويات فريدة وحصص صحيحة مجموعها 10000 bps
 * @returns الأنصبة بالفلس مرتبة بهوية الموظفة، دون تعديل المدخلات
 */
export function allocateLineShares(
  net: bigint,
  performers: readonly LinePerformerShare[],
): Map<string, bigint> {
  const ordered = [...performers].sort((a, b) =>
    a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0,
  );
  const shares = new Map(
    ordered.map((performer) => [performer.employeeId, (net * performer.shareBps) / 10000n]),
  );
  let remainder = net - [...shares.values()].reduce((sum, share) => sum + share, 0n);
  for (const performer of ordered) {
    if (remainder === 0n) break;
    shares.set(performer.employeeId, (shares.get(performer.employeeId) ?? 0n) + 1n);
    remainder -= 1n;
  }
  return shares;
}
