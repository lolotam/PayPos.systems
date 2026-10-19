import { PlaywrightDocumentRenderer, fixtureDocument } from '../dist/index.js';

const uid = typeof process.getuid === 'function' ? process.getuid() : null;
console.log(`uid=${uid === null ? 'unavailable' : String(uid)}`);
if (uid === 0) {
  console.error('pdf smoke refuses root');
  process.exit(1);
}

const renderer = new PlaywrightDocumentRenderer();
try {
  await renderer.start();
  if (!renderer.isAvailable()) {
    console.error('pdf smoke: renderer unavailable');
    process.exit(1);
  }
  const pdf = await renderer.render(fixtureDocument({ language: 'ar', lines: ['pospay-pdf-smoke'] }));
  const header = Buffer.from(pdf.subarray(0, 5)).toString('latin1');
  if (!header.startsWith('%PDF-')) {
    console.error('pdf smoke: output is not a PDF');
    process.exit(1);
  }
} finally {
  await renderer.close();
}
