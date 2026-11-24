import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const JOURNAL = new URL('meta/_journal.json', MIGRATIONS_DIR);
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
    sql: readFileSync(new URL(`${entry.tag}.sql`, MIGRATIONS_DIR), 'utf8'),
  }));
  const add = contents.filter(({ sql }) => sql.includes(ADD));
  const validate = contents.filter(({ sql }) => sql.includes(VALIDATE) && !sql.includes(ADD));
  if (add.length !== 1 || validate.length !== 1)
    throw new Error(
      `Expected one user_nav_style add and one validate migration, got ${add.length}/${validate.length}`,
    );
  return [add[0]!, validate[0]!].map(({ tag, sql }, index) => ({
    sql: sql.split('--> statement-breakpoint'),
    hash: tag,
    folderMillis: 9_999_999_999_990 + index,
  }));
}
