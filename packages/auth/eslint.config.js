import config, { allowDatabaseFacade } from '@pospay/config/eslint';

export default [...config, allowDatabaseFacade('createAuthDatabase', { credentials: true })];
