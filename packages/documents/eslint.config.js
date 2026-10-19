import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [...config, { files: ['src/html/fixture.ts'], ...allowUserFacingText() }];
