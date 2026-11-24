import type { NavStyle } from '@pospay/contracts';

/** الانتظار يحتفظ بآخر اختيار فقط؛ إنهاء الهوية يلغي الطابور ولا يعيد إرسال شيء تحت جلسة جديدة. */
export function createNavStyleSaver(
  save: (style: NavStyle, signal: AbortSignal) => Promise<void>,
  onResult: (failed: boolean) => void,
) {
  let active = true;
  let inFlight = false;
  let waiting: NavStyle | undefined;
  const controller = new AbortController();
  const drain = async (): Promise<void> => {
    if (!active || inFlight || waiting === undefined) return;
    const style = waiting;
    waiting = undefined;
    inFlight = true;
    try {
      await save(style, controller.signal);
      if (active) onResult(false);
    } catch {
      if (active) onResult(true);
    } finally {
      inFlight = false;
      if (active) void drain();
    }
  };
  return {
    choose(style: NavStyle) {
      if (!active) return;
      waiting = style;
      void drain();
    },
    stop() {
      active = false;
      waiting = undefined;
      controller.abort();
    },
  };
}
