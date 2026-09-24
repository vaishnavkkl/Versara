import type { MethodSection } from './pdf-methods';

export const VIDEO_SECTIONS = [
  { title: 'Optimize & convert', tools: [
    { id: 'compress', title: 'Compress Video', subtitle: 'Target size or quality preset', ios: 'arrow.down.right.and.arrow.up.left', android: 'compress' },
    { id: 'resolution', title: 'Change Resolution', subtitle: '4K, 1080p, 720p & more', ios: 'arrow.up.left.and.arrow.down.right', android: 'hd' },
    { id: 'frame_rate', title: 'Change Frame Rate', subtitle: 'Choose frames per second', ios: 'film.stack', android: 'shutter-speed' },
    { id: 'info', title: 'Video Info', subtitle: 'Size, duration, codec & details', ios: 'info.circle', android: 'info-outline' },
  ] },
  { title: 'Edit & extract', tools: [
    { id: 'trim', title: 'Trim Video', subtitle: 'Choose start & end points', ios: 'scissors', android: 'content-cut' },
    { id: 'crop', title: 'Crop Video', subtitle: 'Frame the area you need', ios: 'crop', android: 'crop' },
    { id: 'frame', title: 'Extract Frame', subtitle: 'Save a moment as an image', ios: 'photo.on.rectangle', android: 'photo-camera' },
    { id: 'mute', title: 'Mute Video', subtitle: 'Remove the audio track', ios: 'speaker.slash', android: 'volume-off' },
  ] },
] as const satisfies readonly MethodSection[];
