import type { MethodSection } from './pdf-methods';

export const AUDIO_SECTIONS = [
  { title: 'Edit & arrange', tools: [
    { id: 'trim', title: 'Trim Audio', subtitle: 'Choose start & end points', ios: 'scissors', android: 'content-cut' },
    { id: 'split', title: 'Split Audio', subtitle: 'Divide a track into clips', ios: 'waveform', android: 'splitscreen' },
    { id: 'merge', title: 'Merge Audio', subtitle: 'Join multiple recordings', ios: 'link', android: 'merge' },
    { id: 'fade', title: 'Fade In & Out', subtitle: 'Create smooth beginnings & endings', ios: 'slider.horizontal.3', android: 'tune' },
  ] },
  { title: 'Adjust sound', tools: [
    { id: 'volume', title: 'Adjust Volume', subtitle: 'Increase or reduce loudness', ios: 'speaker.wave.2', android: 'volume-up' },
    { id: 'normalize', title: 'Normalize Audio', subtitle: 'Balance the volume level', ios: 'waveform.path', android: 'equalizer' },
    { id: 'speed', title: 'Change Speed', subtitle: 'Slow down or speed up a track', ios: 'speedometer', android: 'speed' },
    { id: 'pitch', title: 'Change Pitch', subtitle: 'Raise or lower the tone', ios: 'music.note', android: 'music-note' },
  ] },
  { title: 'Convert & export', tools: [
    { id: 'convert', title: 'Convert Audio', subtitle: 'Explore audio format options', ios: 'arrow.triangle.2.circlepath', android: 'swap-horiz' },
    { id: 'compress', title: 'Compress Audio', subtitle: 'Reduce the file size', ios: 'arrow.down.right.and.arrow.up.left', android: 'compress' },
    { id: 'extract', title: 'Video to Audio', subtitle: 'Extract a video soundtrack', ios: 'film', android: 'video-file' },
    { id: 'info', title: 'Audio Info', subtitle: 'Duration, format & file details', ios: 'info.circle', android: 'info-outline' },
  ] },
] as const satisfies readonly MethodSection[];
