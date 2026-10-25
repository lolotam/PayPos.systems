import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { FAILURE_MESSAGES, failureLine } from './counter-auth-labels.mjs';

function assertionMessages(source) {
  const messages = [];
  const call = /\b(?:XCTAssert[A-Za-z]*|XCTFail|assertVisible|assertHittable|tapButton|type)\s*\(/g;
  for (const match of source.matchAll(call)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let quoted = false;
    for (let index = start; index < source.length && depth > 0; index += 1) {
      if (source[index] === '"') quoted = !quoted;
      if (quoted) continue;
      if (source[index] === '(') depth += 1;
      if (source[index] === ')') depth -= 1;
      if (depth !== 0) continue;
      const lastArgument = source.slice(start, index).split(',').at(-1);
      const message = lastArgument.match(/^\s*"([^"]*)"\s*$/);
      if (message !== null) messages.push(message[1]);
    }
  }
  return messages;
}

test('a known failure message is returned without a phone-like string from the log', () => {
  const log = 'private prefix Staff sign-in should succeed phone +965 5000 0000 private suffix';

  assert.equal(failureLine(log), 'ui failure: Staff sign-in should succeed');
});

test('an unrecognised log returns only the unknown diagnostic', () => {
  assert.equal(failureLine('private failure +965 5000 0000'), 'ui failure: unknown');
});

test('failure messages match every quoted assertion message in the Swift UI test', async () => {
  const source = await readFile(new URL('./CounterAuthUITests.swift', import.meta.url), 'utf8');

  assert.equal(Object.isFrozen(FAILURE_MESSAGES), true);
  assert.deepEqual([...FAILURE_MESSAGES].sort(), assertionMessages(source).sort());
});
