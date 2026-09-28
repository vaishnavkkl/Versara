// Bundle English recognition data at build time. PDF OCR never downloads at runtime.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../modules/pdf-engine/vendor/android-assets');
const output = resolve(root, 'tessdata/eng.traineddata');
const hash = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';
const digest = data => createHash('sha256').update(data).digest('hex');
if (!existsSync(output) || digest(readFileSync(output)) !== hash) {
  const response = await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata', { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`OCR model download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest(data) !== hash) throw new Error('OCR model checksum mismatch.');
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, data);
}
mkdirSync(resolve(root, 'licenses/tesseract'), { recursive: true });
writeFileSync(resolve(root, 'licenses/tesseract/NOTICE'), 'Tesseract4Android 4.9.0 and Tesseract tessdata_fast 4.1.0 English model: Apache License 2.0.\nhttps://github.com/adaptech-cz/Tesseract4Android\nhttps://github.com/tesseract-ocr/tessdata_fast\nLeptonica: BSD 2-Clause. libjpeg and libpng retain their upstream licenses.\n');
// Keep the full Apache license alongside the model in the application assets.
const license = resolve(root, 'licenses/tesseract/LICENSE');
if (!existsSync(license)) {
  const response = await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/LICENSE', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('OCR license download failed.');
  writeFileSync(license, await response.text());
}
