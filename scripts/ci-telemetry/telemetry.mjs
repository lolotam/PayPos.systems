// A Turbo run summary carries command lines, environment variable names, input hashes and absolute
// paths. Only the fields listed here may leave the machine, and only when the value passes the
// validator of its own field, so the uploaded artifact is a measurement and never a copy of the workspace.

import { copyMeta, TURBO_VERSION_PATTERN } from './meta.mjs';

const PACKAGE_PATTERN = /^@pospay\/[a-z0-9-]{1,40}$/;
const TASK_PATTERN = /^[a-z][a-z0-9:-]{0,30}$/;
const LABEL_PATTERN = /^[a-z0-9-]{1,60}$/;
const INCOMPLETE_PATTERN = /^[a-z0-9][a-z0-9: ._-]{0,119}$/;

// The reasons a summary is not whole. `complete` says only that: it never says whether the job passed.
const COMPLETENESS_REASONS = new Set([
  'shape',
  'empty',
  'unfinished',
  'count-mismatch',
  'task-without-exit',
  'malformed',
]);

export const isPackage = (value) => typeof value === 'string' && PACKAGE_PATTERN.test(value);
export const isTask = (value) => typeof value === 'string' && TASK_PATTERN.test(value);
export const isTurboVersion = (value) =>
  typeof value === 'string' && TURBO_VERSION_PATTERN.test(value);
export const isLabel = (value) => typeof value === 'string' && LABEL_PATTERN.test(value);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const asTime = (value) => (isNonNegative(value) ? value : null);

const asCount = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

const asExitCode = (value) => (Number.isInteger(value) ? value : null);

const durationOf = (startTime, endTime) =>
  startTime === null || endTime === null || endTime < startTime ? null : endTime - startTime;

const cacheStatusOf = (value) => (value === 'HIT' || value === 'MISS' ? value : 'UNKNOWN');

const cacheSourceOf = (value) => (value === 'LOCAL' || value === 'REMOTE' ? value : null);

const validReason = (value) => (COMPLETENESS_REASONS.has(value) ? value : null);

const validDependency = (value) => {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf('#');
  if (separator === -1) return null;
  const packageName = value.slice(0, separator);
  const taskName = value.slice(separator + 1);
  if (!isPackage(packageName) || !isTask(taskName)) return null;
  return `${packageName}#${taskName}`;
};

const validDependencies = (value) =>
  Array.isArray(value) ? value.map(validDependency).filter((entry) => entry !== null) : [];

// The task is rebuilt field by field, never copied and trimmed: a name that does not match its own
// pattern leaves the artifact as null instead of travelling as text.
const buildTask = (raw) => {
  const task = isPlainObject(raw) ? raw : {};
  const execution = isPlainObject(task.execution) ? task.execution : {};
  const cache = isPlainObject(task.cache) ? task.cache : {};
  const packageName = isPackage(task.package) ? task.package : null;
  const taskName = isTask(task.task) ? task.task : null;
  const expectedId = packageName && taskName ? `${packageName}#${taskName}` : null;
  const cacheStatus = cacheStatusOf(cache.status);
  const startTime = asTime(execution.startTime);
  const endTime = asTime(execution.endTime);
  return {
    taskId: expectedId && task.taskId === expectedId ? expectedId : null,
    task: taskName,
    package: packageName,
    cacheStatus,
    cacheSource: cacheSourceOf(cache.source),
    startTime,
    endTime,
    durationMs: durationOf(startTime, endTime),
    // Only a replay saves time, so a MISS never carries a saving whatever the summary holds.
    timeSavedMs: cacheStatus === 'HIT' ? asTime(cache.timeSaved) : null,
    exitCode: asExitCode(execution.exitCode),
    dependencies: validDependencies(task.dependencies),
  };
};

// A MISS omits its source; a HIT needs a source and saved time, even without an exit code.
const malformedTask = (raw, task) => {
  if (!task.taskId || task.cacheStatus === 'UNKNOWN') return true;
  if (!isNonNegative(raw.cache?.timeSaved)) return true;
  if (task.cacheStatus === 'HIT' && task.cacheSource === null) return true;
  if (
    task.cacheStatus === 'MISS' &&
    (raw.cache.timeSaved !== 0 || raw.cache.source !== undefined)
  ) {
    return true;
  }
  if (!Array.isArray(raw.dependencies) || raw.dependencies.length !== task.dependencies.length) {
    return true;
  }
  return raw.execution?.exitCode != null && task.exitCode === null;
};

const sortByDuration = (tasks) =>
  tasks.filter(isPlainObject).sort((left, right) => {
    if (left.durationMs === null) return right.durationMs === null ? 0 : 1;
    if (right.durationMs === null) return -1;
    return right.durationMs - left.durationMs;
  });

const completenessReason = ({ attempted, exitCode, startTime, endTime, tasks }) => {
  if (tasks.length === 0) return 'empty';
  if (exitCode === null) return 'unfinished';
  if (startTime === null || endTime === null || endTime < startTime) return 'unfinished';
  if (tasks.some((task) => task.durationMs === null)) return 'unfinished';
  if (attempted === null || attempted !== tasks.length) return 'count-mismatch';
  if (tasks.some((task) => task.cacheStatus !== 'HIT' && task.exitCode === null)) {
    return 'task-without-exit';
  }
  return null;
};

const buildRun = (fields, tasks, forcedReason) => {
  const startTime = asTime(fields.startTime);
  const endTime = asTime(fields.endTime);
  const exitCode = asExitCode(fields.exitCode);
  const attempted = asCount(fields.attempted);
  const cached = asCount(fields.cached);
  const failed = asCount(fields.failed);
  const succeeded = asCount(fields.succeeded);
  const builtTasks = sortByDuration(tasks);
  const countsMatch =
    cached + failed + succeeded === attempted &&
    cached === builtTasks.filter((task) => task.cacheStatus === 'HIT').length;
  const reason =
    forcedReason ??
    (isTurboVersion(fields.turboVersion) && [cached, failed, succeeded].every((n) => n !== null)
      ? null
      : 'malformed') ??
    completenessReason({ attempted, exitCode, startTime, endTime, tasks: builtTasks }) ??
    (countsMatch ? null : 'count-mismatch');
  return {
    complete: reason === null,
    reason,
    turboVersion: isTurboVersion(fields.turboVersion) ? fields.turboVersion : null,
    startTime,
    endTime,
    durationMs: durationOf(startTime, endTime),
    exitCode,
    attempted,
    cached,
    failed,
    succeeded,
    tasks: builtTasks,
  };
};

/**
 * يحوّل ملخص تشغيل واحد من Turbo إلى سجل مقيس: المدة، وحالة الكاش، ورمز الخروج لكل مهمة.
 * السجل إما كامل أو ناقص بسبب معروف؛ الاكتمال وحده لا يقول إن الوظيفة نجحت.
 */
export function summariseTurboRun(summary) {
  const source = isPlainObject(summary) ? summary : null;
  const execution = source && isPlainObject(source.execution) ? source.execution : null;
  const tasks = source && Array.isArray(source.tasks) ? source.tasks : null;
  if (!execution || !tasks) {
    return buildRun({}, [], 'shape');
  }
  const builtTasks = tasks.map(buildTask);
  return buildRun(
    {
      turboVersion: source.turboVersion,
      startTime: execution.startTime,
      endTime: execution.endTime,
      exitCode: execution.exitCode,
      attempted: execution.attempted,
      cached: execution.cached,
      failed: execution.failed,
      succeeded: execution.success,
    },
    builtTasks,
    tasks.some((raw, index) => malformedTask(raw, builtTasks[index])) ? 'malformed' : undefined,
  );
}

/**
 * يجمع مهام الاختبار التي أعادها Turbo من الكاش بدل تنفيذها في هذه الوظيفة.
 */
export function replayedTestTasks(runs) {
  const ids = new Set();
  for (const run of Array.isArray(runs) ? runs : []) {
    const tasks = isPlainObject(run) && Array.isArray(run.tasks) ? run.tasks : [];
    for (const task of tasks) {
      if (!isPlainObject(task) || task.cacheStatus !== 'HIT') continue;
      if (!isTask(task.task) || (task.task !== 'test' && !task.task.startsWith('test:'))) continue;
      if (typeof task.taskId !== 'string' || task.taskId === '') continue;
      ids.add(task.taskId);
    }
  }
  return [...ids].sort();
}

/**
 * يبني التقرير النهائي من الملخصات الجاهزة: كل حقل يُنسخ باسمه، ولا يُنشر كائن المصدر.
 */
export function buildReport({ label, meta, runs, incomplete } = {}) {
  const summarised = Array.isArray(runs) ? runs : [];
  return {
    schema: 'ci-telemetry/1',
    label: isLabel(label) ? label : null,
    meta: copyMeta(meta),
    runs: summarised,
    replayedTestTasks: replayedTestTasks(summarised),
    incomplete: Array.isArray(incomplete)
      ? incomplete.filter((entry) => typeof entry === 'string' && INCOMPLETE_PATTERN.test(entry))
      : [],
  };
}

const escapeCell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

const formatSeconds = (value) =>
  isNonNegative(value) ? String(Number((value / 1000).toFixed(3))) : '-';

const countText = (value) => (Number.isInteger(value) ? String(value) : '-');

const durationText = (value) => (isNonNegative(value) ? `${formatSeconds(value)} s` : '-');

// A replay is never shown as an execution: the cell says so, and the time Turbo saved is the
// duration the task would have taken if it had run.
const taskRow = (task) => {
  const name = typeof task.taskId === 'string' && task.taskId !== '' ? task.taskId : '-';
  const status = typeof task.cacheStatus === 'string' ? task.cacheStatus : '-';
  const source =
    task.cacheSource === 'LOCAL' || task.cacheSource === 'REMOTE' ? ` (${task.cacheSource})` : '';
  const duration = formatSeconds(task.durationMs);
  const saved = task.cacheStatus === 'HIT' ? formatSeconds(task.timeSavedMs) : '-';
  const replay = task.cacheStatus === 'HIT' ? ` (replayed, saved ${saved})` : '';
  const exit = Number.isInteger(task.exitCode) ? String(task.exitCode) : '-';
  const cells = [name, `${status}${source}`, `${duration}${replay}`, exit];
  return `| ${cells.map(escapeCell).join(' | ')} |`;
};

const pushList = (lines, title, entries) => {
  lines.push(title);
  const usable = entries.filter((entry) => typeof entry === 'string' && entry !== '');
  if (usable.length === 0) {
    lines.push('- none');
    return;
  }
  for (const entry of usable) lines.push(`- ${escapeCell(entry)}`);
};

/**
 * يحوّل التقرير إلى Markdown قصير لملخص خطوات GitHub.
 */
export function renderMarkdown(report) {
  const source = isPlainObject(report) ? report : {};
  const meta = copyMeta(source.meta);
  const label = isLabel(source.label) ? source.label : '-';
  const runs = Array.isArray(source.runs) ? source.runs : [];
  const lines = [`## CI telemetry · ${label}`, '', `commit: ${meta.commit ?? '-'}`, ''];
  runs.forEach((run, index) => {
    const entry = isPlainObject(run) ? run : {};
    const number = index + 1;
    if (entry.complete !== true) {
      lines.push(`INCOMPLETE turbo run ${number} (${validReason(entry.reason) ?? 'unknown'})`);
    }
    const attempted = countText(entry.attempted);
    const cached = countText(entry.cached);
    const duration = durationText(entry.durationMs);
    lines.push(`turbo run ${number}: ${attempted} tasks, ${cached} cached, ${duration}`);
    const tasks = sortByDuration(Array.isArray(entry.tasks) ? entry.tasks : []).slice(0, 15);
    if (tasks.length > 0) {
      lines.push('');
      lines.push('| task | cache | seconds | exit |');
      lines.push('| --- | --- | --- | --- |');
      for (const task of tasks) lines.push(taskRow(task));
    }
    lines.push('');
  });
  const replayed = Array.isArray(source.replayedTestTasks) ? source.replayedTestTasks : [];
  pushList(lines, 'Replayed from cache (not executed in this job):', replayed);
  lines.push('');
  const incomplete = Array.isArray(source.incomplete)
    ? source.incomplete.filter(
        (entry) => typeof entry === 'string' && INCOMPLETE_PATTERN.test(entry),
      )
    : [];
  pushList(lines, 'Incomplete:', incomplete);
  lines.push('');
  lines.push("Telemetry does not decide whether a step passed; see the step's own result.");
  return `${lines.join('\n')}\n`;
}
