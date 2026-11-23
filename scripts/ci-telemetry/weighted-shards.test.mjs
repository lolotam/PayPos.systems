import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceShards } from '../../apps/api/scripts/ci-balance-shards.ts';

const weighted = (weights) =>
  weights.map((weight, index) => ({ path: `file-${index}.spec.ts`, weight, file: index }));

test('assigns every input once and preserves determinism when discovery order changes', () => {
  const files = weighted([2, 11, 4, 4, 6, 1, 2, 8, 1, 3, 3]);
  const shards = balanceShards(files, 4);
  assert.equal(shards.length, 4);
  assert.deepEqual(
    shards.flat().sort((a, b) => a - b),
    files.map(({ file }) => file),
  );
  assert.deepEqual(balanceShards([...files].reverse(), 4), shards);
});

test('splits heavy files across shards and accepts an empty shard', () => {
  const files = weighted([12, 1, 1, 11, 1, 1]);
  const shards = balanceShards(files, 2);
  const loads = shards.map((shard) => shard.reduce((sum, index) => sum + files[index].weight, 0));
  assert.deepEqual(loads, [14, 13]);
  assert.deepEqual(balanceShards(files.slice(0, 1), 2), [[0], []]);
});
