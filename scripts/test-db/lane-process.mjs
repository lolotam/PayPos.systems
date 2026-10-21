// هوية العملية = الـ pid + وقت بدايتها. الـ pid لوحده بيتعاد استخدامه (بعد restart مثلاً)، فعملية غريبة
// بنفس الـ pid كانت بتخلي lock صاحبه مات يفضل "عايش" للأبد (#450).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// الـ kernel بيعد بالـ ticks؛ USER_HZ على Linux ثابت 100 (10ms للـ tick).
const LINUX_TICK_MS = 10;

function linuxStartMs(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // اسم العملية (field 2) ممكن يكون فيه مسافات وأقواس، فبنعد من بعد آخر ')': أول field هناك هو رقم 3،
  // و starttime هو field 22.
  const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
  const btime = /^btime (\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'));
  if (!Number.isFinite(ticks) || btime === null) return undefined;
  return Number(btime[1]) * 1000 + ticks * LINUX_TICK_MS;
}

function windowsStartMs(pid) {
  // wmic اتشال من Windows 11 24H2، فـ PowerShell هو الطريق الموجود دايماً.
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[DateTimeOffset]::new((Get-Process -Id ${pid} -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()`,
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  );
  return result.status === 0 ? Number(result.stdout.trim()) : undefined;
}

function macStartMs(pid) {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  return result.status === 0 ? Date.parse(result.stdout.trim()) : undefined;
}

/**
 * وقت بداية عملية تانية على نفس الجهاز، بالـ ms من الـ epoch.
 *
 * @param pid رقم العملية
 * @returns وقت البداية، أو undefined لو النظام مقالش (عملية مش موجودة، أو منصة مش مدعومة)
 */
export function processStartMs(pid) {
  try {
    const startMs =
      process.platform === 'linux'
        ? linuxStartMs(pid)
        : process.platform === 'win32'
          ? windowsStartMs(pid)
          : process.platform === 'darwin'
            ? macStartMs(pid)
            : undefined;
    return Number.isFinite(startMs) ? startMs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * وقت بداية العملية الحالية، من غير ما نسأل النظام (السؤال على ويندوز بياخد ثانية أو اتنين).
 *
 * @returns وقت البداية بالـ ms من الـ epoch
 */
export function ownStartMs() {
  return Math.round(performance.timeOrigin);
}
