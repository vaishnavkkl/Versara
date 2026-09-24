import type { MethodSection } from './pdf-methods';

export const IMAGE_SECTIONS = [
  { title: 'Compress & resize', tools: [
    { id: 'compress', title: 'Compress Image', subtitle: 'Target file size or quality', ios: 'arrow.down.right.and.arrow.up.left', android: 'compress' },
    { id: 'batch_compress', title: 'Batch Compress', subtitle: 'Optimize multiple photos', ios: 'square.stack.3d.up', android: 'collections' },
    { id: 'resize', title: 'Resize Image', subtitle: 'Exact pixels or percentage', ios: 'arrow.up.left.and.arrow.down.right', android: 'photo-size-select-large' },
    { id: 'social', title: 'Social Presets', subtitle: 'Post, story & profile sizes', ios: 'rectangle.portrait', android: 'aspect-ratio' },
  ] },
  { title: 'Crop & transform', tools: [
    { id: 'crop', title: 'Crop Image', subtitle: 'Freeform or locked aspect ratio', ios: 'crop', android: 'crop' },
    { id: 'rotate', title: 'Rotate Image', subtitle: 'Turn or straighten a photo', ios: 'rotate.right', android: 'rotate-right' },
    { id: 'flip_h', title: 'Flip Horizontal', subtitle: 'Mirror from left to right', ios: 'arrow.left.and.right.righttriangle.left.righttriangle.right', android: 'flip' },
    { id: 'flip_v', title: 'Flip Vertical', subtitle: 'Mirror from top to bottom', ios: 'arrow.up.and.down', android: 'swap-vert' },
    { id: 'perspective', title: 'Perspective', subtitle: 'Correct angles & alignment', ios: 'viewfinder', android: 'transform' },
    { id: 'canvas', title: 'Canvas & Borders', subtitle: 'Add space, padding & borders', ios: 'square.dashed', android: 'border-outer' },
  ] },
  { title: 'Adjust & enhance', tools: [
    { id: 'brightness', title: 'Brightness', subtitle: 'Lighten or darken your image', ios: 'sun.max', android: 'brightness-6' },
    { id: 'contrast', title: 'Contrast', subtitle: 'Balance light & dark tones', ios: 'circle.lefthalf.filled', android: 'contrast' },
    { id: 'saturation', title: 'Saturation', subtitle: 'Control color intensity', ios: 'drop.halffull', android: 'opacity' },
    { id: 'temperature', title: 'Temperature', subtitle: 'Warm or cool the colors', ios: 'thermometer.medium', android: 'thermostat' },
    { id: 'exposure', title: 'Exposure', subtitle: 'Adjust highlights & shadows', ios: 'plusminus.circle', android: 'exposure' },
    { id: 'sharpen', title: 'Sharpen', subtitle: 'Refine edges & fine detail', ios: 'triangle', android: 'details' },
    { id: 'blur', title: 'Blur', subtitle: 'Soften an image or area', ios: 'drop', android: 'blur-on' },
    { id: 'filters', title: 'Filters', subtitle: 'Monochrome, sepia & more', ios: 'camera.filters', android: 'filter-vintage' },
  ] },
  { title: 'Create & protect', tools: [
    { id: 'text', title: 'Add Text', subtitle: 'Captions, labels & typography', ios: 'textformat', android: 'text-fields' },
    { id: 'draw', title: 'Draw & Annotate', subtitle: 'Mark up with pens & shapes', ios: 'pencil.tip', android: 'draw' },
    { id: 'watermark', title: 'Watermark', subtitle: 'Add a text or image mark', ios: 'seal', android: 'branding-watermark' },
    { id: 'redact', title: 'Redact Image', subtitle: 'Cover sensitive information', ios: 'eye.slash', android: 'visibility-off' },
    { id: 'metadata', title: 'Remove Metadata', subtitle: 'Remove EXIF & GPS details', ios: 'lock.shield', android: 'privacy-tip' },
    { id: 'info', title: 'Image Info', subtitle: 'Dimensions, size & metadata', ios: 'info.circle', android: 'info-outline' },
  ] },
  { title: 'Convert & export', tools: [
    { id: 'convert', title: 'Convert Format', subtitle: 'JPG, PNG, WebP, HEIC & TIFF', ios: 'arrow.triangle.2.circlepath', android: 'swap-horiz' },
    { id: 'pdf', title: 'Images to PDF', subtitle: 'A4, Letter or fit image', ios: 'doc.richtext', android: 'picture-as-pdf' },
    { id: 'rename', title: 'Rename Image', subtitle: 'Give files meaningful names', ios: 'pencil.line', android: 'drive-file-rename-outline' },
    { id: 'batch', title: 'Batch Edit', subtitle: 'Resize, convert & rename a set', ios: 'square.on.square', android: 'library-add-check' },
  ] },
] as const satisfies readonly MethodSection[];
