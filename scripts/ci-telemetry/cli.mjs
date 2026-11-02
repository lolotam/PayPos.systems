import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildMeta } from './meta.mjs';
import { buildReport, isLabel, renderMarkdown, summariseTurboRun } from './telemetry.mjs';

const USAGE_ERROR = 'ci-telemetry: usage error (E_USAGE)';
const INTERNAL_ERROR = '::error title=ci-telemetry::telemetry report failed (E_INTERNAL)';

const parseOptions = (argv) => {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const separator = argument.indexOf('=');
    if (separator !== -1) {
      options.set(argument.slice(2, separator), argument.slice(separator + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options.set(argument.slice(2), undefined);
      continue;
    }
    options.set(argument.slice(2), next);
    index += 1;
  }
  return options;
};

// The report holds the position of a file, never its name: a name may carry a path of the runner.
const readRuns = (directory) => {
  const incomplete = [];
  const runs = [];
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return { runs, incomplete: ['turbo-runs: missing'] };
  }
  const files = names.filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) return { runs, incomplete: ['turbo-runs: none found'] };
  files.forEach((name, position) => {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    } catch {
      incomplete.push(`turbo-run ${position + 1}: invalid-json`);
      return;
    }
    // A Turbo run file holds one summary; a list of summaries is read too, so a batch file does not
    // turn into a shape error that hides the tasks it holds.
    const summaries = Array.isArray(parsed) ? parsed : [parsed];
    for (const summary of summaries) runs.push(summariseTurboRun(summary));
  });
  return { runs, incomplete };
};

const main = (argv) => {
  const options = parseOptions(argv);
  const label = options.get('label');
  const turboRuns = options.get('turbo-runs');
  const out = options.get('out');
  if (!isLabel(label) || typeof turboRuns !== 'string' || typeof out !== 'string') {
    console.error(USAGE_ERROR);
    return 2;
  }
  const { runs, incomplete } = readRuns(turboRuns);
  const meta = buildMeta(process.env, process.version);
  const report = buildReport({ label, meta, runs, incomplete });
  const markdown = renderMarkdown(report);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(out, `${label}.md`), markdown, 'utf8');
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (typeof stepSummary === 'string' && stepSummary !== '') {
    appendFileSync(stepSummary, markdown, 'utf8');
  }
  console.log(`ci-telemetry: report written for ${label}`);
  return 0;
};

// The report states what it found; the gate steps decide the job, so a telemetry failure is reported
// as one line without the message, the stack or any path.
try {
  process.exit(main(process.argv.slice(2)));
} catch {
  console.error(INTERNAL_ERROR);
  process.exit(1);
}
