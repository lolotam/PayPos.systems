type StopListener = () => void;

const listeners = new Set<StopListener>();

// إشارة محلية لهذا التبويب فقط: بلا storage ولا قناة ولا تخزين، عشان حفظ الحساب ما يروحش لجلسة جديدة.
export function stopNavStyleSaving(): void {
  for (const listener of [...listeners]) listener();
}

export function onNavStyleSavingStopped(listener: StopListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
