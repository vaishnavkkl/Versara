import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const engine = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the pinned Collabora engine directory');

const makefile = resolve(engine, 'android/Bootstrap/Makefile.shared');
const symbolMap = resolve(engine, 'android/Bootstrap/version.map');
const originalMakefile = readFileSync(makefile, 'utf8');
const originalMap = readFileSync(symbolMap, 'utf8');

const prerequisite = 'native-code.cxx $(ALL_STATIC_LIBS)';
const command = 'native-code.cxx -L$(INSTDIR)';
const exportSymbol = '        cokit_*;';
if (originalMakefile.split(prerequisite).length !== 2 ||
    originalMakefile.split(command).length !== 2 ||
    originalMap.split(exportSymbol).length !== 2) {
  throw new Error('Pinned Collabora build files changed; review the native link patch');
}

const patchedMakefile = originalMakefile
  .replace(prerequisite, 'native-code.cxx $(VERSARA_COKIT_BRIDGE) $(ALL_STATIC_LIBS)')
  .replace(command,
    'native-code.cxx $(VERSARA_COKIT_BRIDGE) -I$(VERSARA_COKIT_HEADERS) -DVERSARA_WITH_COKIT=1 -L$(INSTDIR)');
const patchedMap = originalMap.replace(exportSymbol,
  `${exportSymbol}\n        versara_cokit_*;`);
writeFileSync(makefile, patchedMakefile);
writeFileSync(symbolMap, patchedMap);
