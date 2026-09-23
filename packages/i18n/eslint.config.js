import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [...config, allowUserFacingText()];
