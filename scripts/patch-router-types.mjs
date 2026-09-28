// Router Server 57.0.10 compares Windows watcher paths with POSIX route keys.
// Normalize before the containment check so files outside src/app never become routes.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const cli = dirname(require.resolve('@expo/cli/package.json', { paths: [require.resolve('expo/package.json')] }));
const root = dirname(require.resolve('@expo/router-server/package.json', { paths: [cli] }));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (version !== '57.0.10') throw new Error(`Review the Windows typed-route workaround for @expo/router-server ${version}.`);
const file = join(root, 'build/typed-routes/index.js');
const original = readFileSync(file, 'utf8');
const before = 'let relativePath = node_path_1.default.relative(process.env.EXPO_ROUTER_APP_ROOT, filePath);';
const after = "let relativePath = node_path_1.default.relative(process.env.EXPO_ROUTER_APP_ROOT, filePath).split(node_path_1.default.sep).join('/');";
if (original.includes(before)) writeFileSync(file, original.replace(before, after));
else if (!original.includes(after)) throw new Error('Typed-route watcher changed; review the Windows workaround.');
