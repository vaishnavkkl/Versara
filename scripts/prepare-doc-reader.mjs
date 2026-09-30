import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'assets', 'doc-reader');
mkdirSync(output, { recursive: true });

const scripts = [
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.script.html'],
  ['node_modules/lodash/lodash.min.js', 'lodash.script.html'],
  [existsSync(join(root, 'node_modules/docx-renderer/node_modules/konva/konva.min.js'))
    ? 'node_modules/docx-renderer/node_modules/konva/konva.min.js'
    : 'node_modules/konva/konva.min.js', 'konva.script.html'],
  ['node_modules/docx-renderer/dist/docx-renderer.umd.js', 'docx-renderer.script.html'],
];

for (const [source, target] of scripts) copyFileSync(join(root, source), join(output, target));
copyFileSync(join(root, 'node_modules/docx-renderer/NOTICE'), join(output, 'NOTICE'));
copyFileSync(join(root, 'node_modules/jszip/LICENSE.markdown'), join(output, 'JSZIP-LICENSE'));
copyFileSync(join(root, 'node_modules/lodash/LICENSE'), join(output, 'LODASH-LICENSE'));
copyFileSync(join(root, existsSync(join(root, 'node_modules/docx-renderer/node_modules/konva/LICENSE'))
  ? 'node_modules/docx-renderer/node_modules/konva/LICENSE'
  : 'node_modules/konva/LICENSE'), join(output, 'KONVA-LICENSE'));
