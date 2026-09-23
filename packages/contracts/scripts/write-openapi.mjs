import { writeFileSync } from 'node:fs';

import { buildOpenApiDocument } from '../dist/index.js';

const target = new URL('../openapi/openapi.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log('openapi/openapi.json written');
