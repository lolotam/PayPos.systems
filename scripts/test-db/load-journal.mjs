import { appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parseDockerStats } from './load-parser.mjs';

// الدليل الممرّر لازم يكون خاص بالمحاولة؛ wx يمنع طمس دليل محاولة قديمة.
export function createLoadJournal(directory, options) {
  const paths = Object.fromEntries(
    ['docker.stdout.raw', 'docker.stderr.raw', 'sales.jsonl', 'host.jsonl'].map((name) => [
      name,
      join(directory, name),
    ]),
  );
  for (const path of Object.values(paths)) writeFileSync(path, '', { flag: 'wx' });
  let ended = false;
  const append = (name, bytes) => {
    if (ended) throw new Error('Load journal is closed');
    appendFileSync(paths[name], bytes, { flush: true });
  };
  const json = (name, value) => append(name, JSON.stringify(value) + '\n');
  const lines = (name) =>
    readFileSync(paths[name], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const status = (value) => {
    writeFileSync(join(directory, 'status.tmp'), JSON.stringify(value, null, 2), { flush: true });
    renameSync(join(directory, 'status.tmp'), join(directory, 'status.json'));
  };
  status({ accepted: false, state: 'collecting' });
  return {
    stdout: (chunk) => append('docker.stdout.raw', chunk),
    stderr: (chunk) => append('docker.stderr.raw', chunk),
    sale: (value) => json('sales.jsonl', value),
    host: (value) => json('host.jsonl', value),
    finish({ expectedSales, hostSamples = [], streamClosed = false, streamError = null }) {
      if (ended) throw new Error('Load journal is closed');
      try {
        for (const sample of hostSamples) json('host.jsonl', sample);
        ended = true;
        const docker = parseDockerStats(readFileSync(paths['docker.stdout.raw']), options);
        const sales = lines('sales.jsonl');
        const host = lines('host.jsonl');
        if (!streamClosed || streamError || readFileSync(paths['docker.stderr.raw']).length)
          throw new Error('Unclean Docker stream');
        if (!Number.isInteger(expectedSales) || expectedSales < 1 || sales.length !== expectedSales)
          throw new Error('Incomplete sale samples');
        if (
          sales.some(
            (s, i) =>
              s.trial !== i ||
              !Number.isFinite(s.elapsed) ||
              s.elapsed < 0 ||
              !Array.isArray(s.phases),
          )
        )
          throw new Error('Invalid sale samples');
        if (
          host.length < 2 ||
          host.some(
            (s) =>
              !Number.isFinite(s.cpu) ||
              s.cpu < 0 ||
              s.cpu > 100 ||
              !Number.isFinite(s.free) ||
              s.free < 0,
          )
        )
          throw new Error('Incomplete host samples');
        status({
          accepted: true,
          state: 'complete',
          docker: docker.length,
          sales: sales.length,
          host: host.length,
        });
        return { docker, sales, host };
      } catch (error) {
        ended = true;
        status({ accepted: false, state: 'failed', error: String(error) });
        throw error;
      }
    },
  };
}
