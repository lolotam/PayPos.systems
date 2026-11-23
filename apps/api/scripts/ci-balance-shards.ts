export type WeightedFile<T> = Readonly<{
  path: string;
  weight: number;
  file: T;
}>;

/** يوزّع الملفات الأثقل أولًا على الشريحة ذات الزمن المقدّر الأقل. */
export function balanceShards<T>(files: readonly WeightedFile<T>[], count: number): T[][] {
  const shards = Array.from({ length: count }, () => ({ files: [] as T[], weight: 0 }));
  const sorted = [...files].sort(
    (a, b) => b.weight - a.weight || (a.path < b.path ? -1 : Number(a.path > b.path)),
  );

  for (const item of sorted) {
    const lightest = shards.reduce((best, shard) =>
      shard.weight < best.weight ||
      (shard.weight === best.weight && shard.files.length < best.files.length)
        ? shard
        : best,
    );
    lightest.files.push(item.file);
    lightest.weight += item.weight;
  }

  return shards.map((shard) => shard.files);
}
