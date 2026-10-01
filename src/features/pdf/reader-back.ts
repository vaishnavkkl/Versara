let handler: (() => boolean) | null = null;
let helpHandler: (() => boolean) | null = null;

/** Lets the reader consume a close or back press, for example to leave the tools-around-page view first. */
export function setReaderBackHandler(next: () => boolean) {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

/** True when the reader handled the press and the screen should stay open. */
export function handleReaderBack() {
  return handler?.() ?? false;
}

/** Lets the reader use the header help button, for example to name the tools around the page. */
export function setReaderHelpHandler(next: () => boolean) {
  helpHandler = next;
  return () => { if (helpHandler === next) helpHandler = null; };
}

/** True when the reader handled the press and the guide should not open. */
export function handleReaderHelp() {
  return helpHandler?.() ?? false;
}
