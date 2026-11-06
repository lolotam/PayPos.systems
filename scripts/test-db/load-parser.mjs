// تطبيع تأطير Docker فقط؛ أي سجل حمل تالف أو ناقص يوقف قبول الأدلة.
function percent(value, maximum = Infinity) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?%$/.test(value))
    throw new Error('Invalid load percentage');
  const result = Number(value.slice(0, -1));
  if (!Number.isFinite(result) || result > maximum) throw new Error('Invalid load percentage');
}

function record(value, container) {
  if (!value || Array.isArray(value) || value.Name !== container)
    throw new Error('Unexpected load container');
  if (!/^[a-f0-9]{12,64}$/.test(value.ID ?? '')) throw new Error('Missing load container ID');
  percent(value.CPUPerc); // CPU ممكن يتجاوز 100% لما الحاوية تستخدم أكتر من نواة.
  percent(value.MemPerc, 100);
  const pair = /^\d+(?:\.\d+)?\s*(?:[kKMGTPE]i?)?B\s*\/\s*\d+(?:\.\d+)?\s*(?:[kKMGTPE]i?)?B$/;
  for (const field of ['MemUsage', 'BlockIO', 'NetIO']) {
    if (typeof value[field] !== 'string' || !pair.test(value[field]))
      throw new Error('Invalid load field: ' + field);
  }
  return value;
}

export function parseDockerStats(raw, { container, minSamples }) {
  if (!container || !Number.isInteger(minSamples) || minSamples < 2)
    throw new Error('Invalid load coverage requirement');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const records = [];
  const lines = text.split('\n');
  const escape = String.fromCharCode(27);
  const leading = new RegExp('^(?:' + escape + '\\[[0-9;]*[HJKm])+');
  const trailing = new RegExp('(?:' + escape + '\\[[0-9;]*[HJKm])+$');
  for (const [index, line] of lines.entries()) {
    // ما بنشيلش ANSI جوه JSON أو نص مجهول: السماح بتأطير طرفي السطر فقط.
    const json = line.replace(/\r$/, '').replace(leading, '').replace(trailing, '');
    if (json === '') continue;
    if (index === lines.length - 1) throw new Error('Truncated Docker load stream');
    if (Array.from(json).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
      throw new Error('Unexpected Docker control sequence');
    records.push(record(JSON.parse(json), container));
  }
  if (records.length < minSamples) throw new Error('Insufficient Docker load samples');
  return records;
}
