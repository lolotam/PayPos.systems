import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const MIGRATIONS_URL = new URL('../migrations/', import.meta.url);
const JOURNAL = new URL('meta/_journal.json', MIGRATIONS_URL);
const ADD = 'ADD CONSTRAINT "user_nav_style"';
const VALIDATE = 'VALIDATE CONSTRAINT "user_nav_style"';

/** أشكال التهجيرات التي يفهمها concurrent-migrations؛ folderMillis مستقبلي يجبر إعادة التشغيل. */
export interface MigrationFile {
  readonly sql: readonly string[];
  readonly hash: string;
  readonly folderMillis: number;
}

/**
 * بتجيب تهجيرتي nav_style من الجورنال بمحتوى القيد لا برقم مؤقت، فإعادة الترقيم لا تكسر الاختبار.
 * الملف الأول يضيف العمود والقيد NOT VALID والثاني يتحقق منه؛ غير ذلك تعتبر سلسلة تالفة.
 *
 * @returns ملفا التهجير بترتيب التنفيذ
 */
export function readNavStyleMigrationFiles(): MigrationFile[] {
  const journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as {
    entries: ReadonlyArray<{ tag: string }>;
  };
  const contents = journal.entries.map((entry) => ({
    tag: entry.tag,
    sql: readFileSync(new URL(`${entry.tag}.sql`, MIGRATIONS_URL), 'utf8'),
  }));
  const addMatches = contents.filter(({ sql }) => sql.includes(ADD));
  const validateMatches = contents.filter(({ sql }) => sql.includes(VALIDATE) && !sql.includes(ADD));
  const [add] = addMatches;
  const [validate] = validateMatches;
  if (add === undefined || validate === undefined)
    throw new Error(
      `Expected one user_nav_style add and one validate migration, got ${addMatches.length}/${validateMatches.length}`,
    );
  return [add, validate].map(({ tag, sql }, index) => ({
    sql: sql.split('--> statement-breakpoint'),
    hash: tag,
    folderMillis: 9_999_999_999_990 + index,
  }));
}
