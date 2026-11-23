import { useVisiblePageIds } from './use-visible-page-ids';

/** عنصر اختبار: يعرض معرّفات الصفحات التي تراها القوائم الآن، بالقراءات الحقيقية خلف كل شرط ظهور. */
export function VisibleIdsProbe() {
  const ids = useVisiblePageIds();
  return (
    <ul aria-label="Visible pages">
      {ids.map((id) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  );
}
