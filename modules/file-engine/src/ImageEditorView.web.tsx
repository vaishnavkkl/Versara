// Image editing runs only in the Android and iOS apps.
export type ImageCrop = { x: number; y: number; width: number; height: number };
export const hasNativeImageEditor = false;
export default function ImageEditorView() { return null; }
