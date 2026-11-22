import { useCallback, useEffect, useRef } from 'react';

/** إجراء «إضافة تصنيف» الذي تملك الشاشة زرّه في ترويسة واحدة، وينفّذه العرض الظاهر. */
export type CreateAction = { run: () => void; disabled: boolean };
export type RegisterCreateAction = (action: CreateAction | null) => void;

/** صلة الصفحة بالشاشة الضامّة: دالة التسجيل، وهل هذا العرض هو الظاهر الآن (المحمول المخفي لا يسجّل). */
export type CreateEmbed = { register: RegisterCreateAction; active: boolean };

/**
 * يسجّل إجراء الإنشاء عند الشاشة طالما العرض ظاهرًا، ويسحبه عند إخفائه أو فكّه؛
 * ولا يفعل شيئًا حين لا تكون الصفحة مضمَّنة في شاشة (تعرض ترويستها بنفسها).
 * التسجيل يعتمد على قيمتين بدائيتين وعلى مرجع لآخر دالة، فلا يُعاد كل رندر مهما تغيّرت هوية الدالة.
 *
 * @param embed    صلة الشاشة الضامّة، أو undefined للصفحة المستقلة
 * @param run      بدء الإنشاء
 * @param disabled تعطيل الزر مؤقتًا أثناء كتابة جارية
 */
export function useRegisterCreateAction(
  embed: CreateEmbed | undefined,
  run: () => void,
  disabled: boolean,
) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const register = embed?.register;
  const active = embed?.active === true;
  const stableRun = useCallback(() => latest.current(), []);
  useEffect(() => {
    if (!register || !active) return;
    register({ run: stableRun, disabled });
    return () => register(null);
  }, [register, active, disabled, stableRun]);
}
