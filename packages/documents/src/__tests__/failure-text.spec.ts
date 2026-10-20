import { expect, it } from 'vitest';

import {
  DocumentRenderTimeoutError,
  DocumentRendererUnavailableError,
  DocumentTooLargeError,
} from '../domain/errors.ts';
import { rendererFailureText } from '../domain/failure-text.ts';

const PERSON = 'Noura Salim';
const ATTENDANCE = 'attendance 08:17';

function line(error: unknown): string {
  return JSON.stringify(rendererFailureText(error));
}

it('logs neither a person name nor an attendance value', () => {
  const error = new Error(`${ATTENDANCE} late`);
  error.name = PERSON;
  const text = line(error);
  expect(text).toBe('{"error_class":"OTHER"}');
  expect(text).not.toContain(PERSON);
  expect(text).not.toContain('Noura');
  expect(text).not.toContain(ATTENDANCE);
  expect(text).not.toContain('08:17');
  expect(text).not.toContain('error_message');
});

it('keeps an allowlisted class when the name was overwritten', () => {
  const error = new TypeError(`${PERSON} ${ATTENDANCE}`);
  error.name = PERSON;
  const text = line(error);
  expect(text).toBe('{"error_class":"TypeError"}');
  expect(text).not.toContain(PERSON);
  expect(text).not.toContain(ATTENDANCE);
});

it('maps builtin and document errors to fixed tokens', () => {
  expect(rendererFailureText(new RangeError(ATTENDANCE)).error_class).toBe('RangeError');
  expect(rendererFailureText(new DocumentRenderTimeoutError()).error_class).toBe(
    'DocumentRenderTimeoutError',
  );
  expect(rendererFailureText(new DocumentTooLargeError('pdf')).error_class).toBe(
    'DocumentTooLargeError',
  );
  expect(rendererFailureText(new DocumentRendererUnavailableError()).error_class).toBe(
    'DocumentRendererUnavailableError',
  );
  const timeout = new Error(ATTENDANCE);
  timeout.name = 'TimeoutError';
  expect(rendererFailureText(timeout).error_class).toBe('TimeoutError');
  const unknown = new Error(ATTENDANCE);
  unknown.name = 'DocumentKindUnknownError';
  expect(rendererFailureText(unknown).error_class).toBe('DocumentKindUnknownError');
  expect(rendererFailureText('Noura')).toEqual({ error_class: 'OTHER' });
});

it('maps a missing browser executable or library without its path', () => {
  const executable = new Error(
    `Executable doesn't exist at /opt/pw/chrome\n${PERSON} ${ATTENDANCE}`,
  );
  const library = new Error(`Host system is missing dependencies to run browsers. ${PERSON}`);
  const shared = new Error(`error while loading shared libraries: libnss3.so ${ATTENDANCE}`);
  expect(line(executable)).toBe('{"error_class":"MISSING_EXECUTABLE"}');
  expect(line(library)).toBe('{"error_class":"MISSING_LIBRARY"}');
  expect(line(shared)).toBe('{"error_class":"MISSING_LIBRARY"}');
  const joined = `${line(executable)}\n${line(library)}\n${line(shared)}`;
  expect(joined).not.toContain('/opt/pw');
  expect(joined).not.toContain('libnss3');
  expect(joined).not.toContain(PERSON);
  expect(joined).not.toContain(ATTENDANCE);
});
