import { relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { balanceShards } from './scripts/ci-balance-shards.ts';
import timing from './scripts/ci-api-timing.json' with { type: 'json' };
import base from './vitest.config.ts';

const durations: Readonly<Record<string, number>> = timing.durationsMs;
const DEFAULT_TEST_MS = 1_000;
const SETUP_MS_PER_FILE = 1_500;

class TimingBalancedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;

    const weighted = files.map((file) => {
      const path = relative(file.project.config.root, file.moduleId).replaceAll('\\', '/');
      const duration = durations[path];
      const weight =
        (typeof duration === 'number' ? duration : DEFAULT_TEST_MS) + SETUP_MS_PER_FILE;
      return { path, weight, file };
    });

    return balanceShards(weighted, shard.count)[shard.index - 1] ?? [];
  }
}

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    sequence: { ...base.test?.sequence, sequencer: TimingBalancedSequencer },
  },
});
