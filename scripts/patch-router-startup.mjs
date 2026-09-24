// Expo Router 57.0.22 starts initial-link resolution during render. Its promise
// can notify NavigationContainer before commit: https://github.com/expo/expo/issues/49378
// Keep this narrowly scoped patch reproducible after npm install / npm ci.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('expo-router/package.json'));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (version !== '57.0.22') {
  throw new Error(`Review/remove the Router startup workaround for expo-router ${version}; it targets 57.0.22.`);
}

const file = join(root, 'build/fork/NavigationContainer.js');
const original = readFileSync(file, 'utf8');
const source = original.replace(/\r\n/g, '\n');
const anchor = '    const [lastUnhandledLink, setLastUnhandledLink] = react_1.default.useState();';
const replacement = `${anchor}
    // Versara: defer initial-link notifications until this render commits.
    const linkingLifecycle = react_1.default.useRef('before-mount');
    const pendingLink = react_1.default.useRef(null);
    const reportUnhandledLink = react_1.default.useCallback((path) => {
        if (linkingLifecycle.current === 'mounted') {
            setLastUnhandledLink(path);
        } else if (linkingLifecycle.current === 'before-mount') {
            pendingLink.current = { path };
        }
    }, []);
    react_1.default.useEffect(() => {
        linkingLifecycle.current = 'mounted';
        const pending = pendingLink.current;
        pendingLink.current = null;
        if (pending) {
            // A child navigator may already have handled this link in onReady.
            const routePath = refContainer.current?.getCurrentRoute()?.path;
            setLastUnhandledLink(routePath === pending.path ? undefined : pending.path);
        }
        return () => {
            linkingLifecycle.current = 'unmounted';
            pendingLink.current = null;
        };
    }, []);`;
const oldCallback = '    }, setLastUnhandledLink);';
const newCallback = '    }, reportUnhandledLink);';

if (source.includes(replacement) && source.includes(newCallback)) {
  console.log('Expo Router startup workaround is already applied.');
} else {
  if (source.includes('Versara: defer initial-link') || source.split(anchor).length !== 2 || source.split(oldCallback).length !== 2) {
    throw new Error('Expo Router startup source changed; refusing to apply a partial workaround.');
  }
  const patched = source.replace(anchor, replacement).replace(oldCallback, newCallback);
  writeFileSync(file, original.includes('\r\n') ? patched.replace(/\n/g, '\r\n') : patched);
  console.log('Applied Expo Router startup workaround.');
}
