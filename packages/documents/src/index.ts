export type { DocumentRenderer, RenderOptions } from './ports/document-renderer.ts';
export {
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
} from './domain/errors.ts';
export {
  assertBytesWithinLimit,
  assertHtmlWithinLimit,
  assertPdfWithinLimit,
} from './domain/limits.ts';
export { escapeHtml } from './domain/escape.ts';
export { rendererFailureText, type RendererFailureText } from './domain/failure-text.ts';
export type { HtmlFragment } from './html/fragment.ts';
export { html, type HtmlSlot } from './html/template.ts';
export { baseLayout, bdi, type LayoutInput } from './html/layout.ts';
export { fixtureDocument, type FixtureInput } from './html/fixture.ts';
export { imageDataUri, type ImageMime } from './html/image.ts';
export { attendanceStatementHtml } from './templates/attendance-statement.ts';
export {
  buildCommissionStatementWorkbook,
  type CommissionStatementLabels,
  type CommissionStatementLanguage,
  type CommissionStatementPaidCash,
  type CommissionStatementWorkbookInput,
} from './excel/commission-statement.ts';
export {
  COMMISSION_STATEMENT_ROW_KINDS,
  type CommissionStatementEmployeeTotal,
  type CommissionStatementRowKind,
  type CommissionStatementWorkbookRow,
} from './excel/commission-statement-rows.ts';
export { fontFaceCss } from './fonts/ibm-plex.ts';
export { PlaywrightDocumentRenderer, type RendererOptions } from './playwright/renderer.ts';
