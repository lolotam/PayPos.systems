import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { useBrowserConnectivity } from './use-browser-connectivity';

function Probe() {
  return <span>{String(useBrowserConnectivity())}</span>;
}

it('is unknown on the server render so nothing starts before the browser state is read', () => {
  expect(renderToString(<Probe />)).toContain('null');
});
