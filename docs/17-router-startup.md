# Router startup warning

Expo Router 57.0.22 invokes `setLastUnhandledLink` from its initial URL promise. That promise is created during render by `useThenable`, so it can settle before NavigationContainer commits, triggering React's "component hasn't mounted yet" warning. This matches the installed source and [Expo issue 49378](https://github.com/expo/expo/issues/49378).

`scripts/patch-router-startup.mjs` patches the installed NavigationContainer to retain an early link notification in a ref, publish it from `useEffect` after mount, and ignore notifications after unmount. A link already handled by the child navigator is cleared when the pending notification is flushed. Initial URL parsing, navigation state and subsequent deep-link subscriptions are preserved. No LogBox filtering or delay timer is used.

The patch runs before PDFium preparation in `postinstall`, so installs and EAS builds retain it. It only accepts the inspected version and expected source; review/remove it when upgrading Expo Router. Applying it again is safe. Restart Metro with `npx.cmd expo start --clear` and fully reopen the app to discard the previously loaded Router module. This JavaScript fix does not require rebuilding the native binary.

Validation: lint, TypeScript and JavaScript syntax checks. No automated tests or web builds. Device validation remains necessary: repeated cold starts, starting from a deep link with parameters, opening links while the app runs, and Fast Refresh should preserve navigation without the warning.
