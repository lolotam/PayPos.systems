import { expect, it } from 'vitest';

import { rendererFailureText } from '../domain/failure-text.ts';

it('keeps the error class and strips paths, urls, and markup', () => {
  const error = new Error(
    'missing /opt/pw/chrome https://cdn.example/lib <b>secret</b> data:text/html,x\nnext /tmp/hidden',
  );
  error.name = 'LaunchError';
  const text = rendererFailureText(error);
  expect(text.error_class).toBe('LaunchError');
  expect(text.error_message).toContain('missing');
  expect(text.error_message).not.toContain('/opt/pw');
  expect(text.error_message).not.toContain('https://');
  expect(text.error_message).not.toContain('<b>');
  expect(text.error_message).not.toContain('data:');
  expect(text.error_message).not.toContain('/tmp/hidden');
  expect(text.error_message).not.toContain('next');
});
