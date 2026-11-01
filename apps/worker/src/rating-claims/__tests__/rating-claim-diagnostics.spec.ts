import { expect, it } from 'vitest';
import { createLogger } from '@pospay/observability';
import { ratingClaimDiagnostics } from '../../modules/customers/persistence/rating-claim-diagnostics.ts';

it('records safe failure diagnostics without messages or private request data', () => {
  let output = '';
  const logger = createLogger('error', {
    destination: {
      write: (line) => {
        output += line;
      },
    },
  });
  const companyId = '01920000-0000-7000-8000-0000000000b2';
  ratingClaimDiagnostics(logger).failed(
    companyId,
    new Error('private synthetic query +999999900001 redis:rating:1'),
  );
  expect(JSON.parse(output)).toMatchObject({
    company_id: companyId,
    code: 'RATING_CLAIM_REQUEST_RETRY',
    failure: { type: 'Error' },
  });
  expect(output).not.toMatch(/private|999999900001|redis:rating/);
  expect(output.trim().split('\n')).toHaveLength(1);
});
