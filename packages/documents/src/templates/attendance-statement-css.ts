/**
 * قواعد طباعة بيان الحضور. كلها منطقية (inline و start/end) عشان العربي والإنجليزي يطبعوا
 * بنفس الشكل، ومفيش left ولا right عشان الاتجاه ما ينعكسش (CLAUDE.md §7).
 */
export const STATEMENT_CSS = [
  '.statement-header { display: flex; gap: 6mm; align-items: center; margin-block-end: 4mm; }',
  '.statement-logo { block-size: 20mm; inline-size: auto; object-fit: contain; }',
  '.statement-headings { flex: 1 1 auto; }',
  '.statement-business { margin-block: 0; font-size: 14pt; font-weight: 700; }',
  '.statement-title { margin-block: 1mm 2mm; font-size: 13pt; font-weight: 700; }',
  '.statement-line { margin-block: 0 1mm; font-size: 10pt; }',
  '.statement-subtitle { margin-block: 6mm 2mm; font-size: 12pt; font-weight: 700; }',
  '.statement-table { width: 100%; border-collapse: collapse; margin-block-end: 4mm; }',
  '.statement-table th, .statement-table td { border: 0.2mm solid #999; padding: 0.8mm 1.2mm; font-size: 9pt; text-align: start; vertical-align: top; }',
  '.statement-table thead { display: table-header-group; }',
  '.statement-table tr { break-inside: avoid; }',
  '.statement-number { text-align: end; white-space: nowrap; }',
  '.statement-signature-cell { min-inline-size: 20mm; }',
  '.statement-session { margin-block-end: 1mm; }',
  '.statement-session-time { display: block; }',
  '.statement-session-flag { display: block; font-size: 8pt; }',
  '.statement-note { display: block; }',
  '.statement-signatures { display: flex; gap: 12mm; margin-block-start: 10mm; }',
  '.statement-signature { flex: 1 1 auto; }',
  '.statement-signature-label { margin-block: 0; font-size: 10pt; }',
  '.statement-signature-rule { border-block-end: 0.2mm solid #333; margin-block-start: 14mm; }',
  '.statement-footer { margin-block: 0; }',
  '.statement-issued { margin-block: 0; }',
  '.statement-totals th, .statement-totals td { font-size: 8pt; padding: 0.6mm 0.8mm; }',
].join('\n');

/**
 * صفحة عرضية لجدول الفرع: ١٦ عمود ما بيتقروا في صفحة طولية. القاعدة في جسم المستند عشان
 * تيجي بعد قاعدة الـ layout الرأسيّة، و Chromium بيطبع بالحجم ده (preferCSSPageSize).
 */
export const LANDSCAPE_PAGE_CSS = '@page { size: A4 landscape; margin: 12mm; }';
