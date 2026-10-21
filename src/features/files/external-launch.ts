/** Set when a cold start opens a content:// or file:// link from another app. */
let skipIntro = false;

/** Remember that this launch should open a file instead of showing the introduction splash. */
export function markExternalFileLaunch() {
  skipIntro = true;
}

/** True when this JS context started by opening a file from outside Versara. */
export function shouldSkipIntroSplash() {
  return skipIntro;
}
