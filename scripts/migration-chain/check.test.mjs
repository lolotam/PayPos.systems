import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMigrationChain, readMigrationChain } from './check.mjs';

function fixture() {
  return [
    {
      entries: [
        { idx: 0, tag: '0000_first' },
        { idx: 1, tag: '0001_second' },
      ],
    },
    ['0000_first.sql', '0001_second.sql'],
    new Map([
      [0, { id: 'first', prevId: 'root' }],
      [1, { id: 'second', prevId: 'first' }],
    ]),
  ];
}

test('migration chain cases', () => {
  const cases = [
    ['clean chain', () => {}, []],
    [
      'new idx gap',
      ([journal]) => {
        journal.entries[1].idx = 2;
      },
      ['entries[1].idx: expected 1, actual 2', 'expected prefix 0002_', '0002_snapshot.json'],
    ],
    [
      'duplicate idx',
      ([journal]) => {
        journal.entries[1].idx = 0;
      },
      ['entries[1].idx: expected 1, actual 0', 'expected prefix 0000_'],
    ],
    [
      'journal tag without SQL',
      ([, sql]) => {
        sql.pop();
      },
      ['0001_second.sql: expected SQL file for journal tag, actual missing'],
    ],
    [
      'SQL without journal entry',
      ([, sql]) => {
        sql.push('0002_extra.sql');
      },
      ['0002_extra.sql: expected journal entry, actual missing'],
    ],
    [
      'broken prevId',
      ([, , snapshots]) => {
        snapshots.get(1).prevId = 'root';
      },
      ['0001_snapshot.json prevId: expected first (meta/0000_snapshot.json id), actual root'],
    ],
    [
      'duplicate snapshot id',
      ([, , snapshots]) => {
        snapshots.get(1).id = 'first';
      },
      ['0001_snapshot.json id: expected unique id, actual first also in meta/0000_snapshot.json'],
    ],
    [
      'reordered idx',
      ([journal]) => {
        journal.entries.reverse();
      },
      ['entries[0].idx: expected 0, actual 1', 'entries[1].idx: expected 2, actual 0'],
    ],
    [
      'allowlisted historical gap',
      ([journal, sql, snapshots]) => {
        journal.entries = [];
        sql.length = 0;
        snapshots.clear();
        for (let idx = 0; idx <= 121; idx++) {
          if (idx === 118 || idx === 119) continue;
          const tag = `${String(idx).padStart(4, '0')}_migration`;
          journal.entries.push({ idx, tag });
          sql.push(`${tag}.sql`);
          snapshots.set(idx, { id: String(idx), prevId: String(idx === 120 ? 117 : idx - 1) });
        }
      },
      [],
    ],
    [
      'wrong prefix',
      ([journal, sql]) => {
        journal.entries[1].tag = '0002_second';
        sql[1] = '0002_second.sql';
      },
      ['expected prefix 0001_, actual 0002_'],
    ],
    [
      'missing latest snapshot',
      ([, , snapshots]) => {
        snapshots.delete(1);
      },
      ['0001_snapshot.json: expected snapshot for journal entry, actual missing'],
    ],
  ];
  for (const name of ['210_new.sql', '0210.sql']) {
    cases.push([
      `malformed SQL name ${name}`,
      ([, sql]) => sql.push(name),
      [`${name}: expected journal entry, actual missing`],
    ]);
  }
  for (const field of ['id', 'prevId']) {
    for (const value of [undefined, null, '', ' ', 42, false, {}]) {
      cases.push([
        `invalid snapshot ${field}: ${JSON.stringify(value)}`,
        ([, , snapshots]) => {
          if (value === undefined) delete snapshots.get(1)[field];
          else snapshots.get(1)[field] = value;
        },
        [`0001_snapshot.json ${field}: expected non-empty string`],
      ]);
    }
  }
  cases.push([
    'broken prevId after snapshot gap in unsorted input',
    ([journal, sql, snapshots]) => {
      journal.entries = [{ idx: 0, tag: '0000_first' }];
      sql.pop();
      snapshots.delete(1);
      snapshots.set(2, { id: 'third', prevId: 'nonexistent' });
      const first = snapshots.get(0);
      snapshots.delete(0);
      snapshots.set(0, first);
    },
    ['0002_snapshot.json prevId: expected first (meta/0000_snapshot.json id), actual nonexistent'],
  ]);
  for (const [name, change, expected] of cases) {
    const data = fixture();
    change(data);
    const errors = checkMigrationChain(...data);
    assert.equal(errors.length, expected.length, name);
    expected.forEach((message, idx) =>
      assert.ok(errors[idx].includes(message), name + ': ' + errors[idx]),
    );
  }
});

test('repository migration chain is valid', () => {
  const directory = new URL('../../packages/db/migrations/', import.meta.url);
  assert.deepEqual(checkMigrationChain(...readMigrationChain(fileURLToPath(directory))), []);
});
