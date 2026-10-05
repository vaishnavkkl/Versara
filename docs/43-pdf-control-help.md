# PDF control help and surround-tool bubbles

The question-mark button on PDF tool screens toggles local help mode. Visible
buttons and text fields show dotted outlines; tapping one displays a message
bubble beside that control and does not perform its action. Tap the question
mark again or use Back to leave help mode. The dedicated PDF reader uses the
same help mode, while its surround tools retain their own naming-mode toggle.

Shared action buttons, menus, page controls, source cards, text styles, colours,
and selection controls participate through HelpPressable. Inputs keep their
normal keyboard-aware implementation outside help mode. Option-sheet portals
explicitly carry the screen's help context, with their own question-mark button.
Disabled controls remain inspectable and report that they are unavailable.

Surround tools in both PDF and image previews now use the same message bubbles
for help taps and long presses. Naming-mode instructions no longer use toasts.
Operation status and success messages elsewhere keep their existing behavior.

Bubbles are measured only when tapped, stay within safe-area bounds, support
scrolling for larger text, and close with the close button, an outside tap, or
Android Back. Resize/background listeners exist only while a bubble is mounted
and are released on teardown. Help state is local to a screen, with no polling,
document processing, or persistent cache.

Bubble layout handlers copy the measured height before scheduling a state update:
React Native releases pooled events after the handler returns, so retaining the
event in an updater can crash immediately after the bubble appears. Bubble close
callbacks stay stable so layout updates do not reinstall lifecycle listeners.
Help outlines use theme-specific blue dots over a contrasting backing, including
selected buttons and the surround tools, which share the same outline renderer.

Verification: lint, TypeScript, and whitespace checks only. Manual checks remain
necessary on Android/iOS for landscape, larger text, sheet controls, disabled
buttons, surround-tool naming, backdrop dismissal, and leaving help before an
actual operation. This is a JavaScript update with no new native dependencies.
