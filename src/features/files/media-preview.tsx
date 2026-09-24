import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import type { RecentFile } from './recent-files';

export function MediaPreview({ file }: { file: RecentFile }) {
  if (file.kind === 'video') return <VideoPreview uri={file.uri} />;
  if (file.kind === 'audio') return <AudioPreview uri={file.uri} />;
  return <ImagePreview uri={file.uri} />;
}
function ImagePreview({ uri }: { uri: string }) {
  const colors = usePalette();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  return <View style={styles.fill}>{error ? <Message text="This image format could not be previewed on your device." /> : <Image source={{ uri }} contentFit="contain" cachePolicy="none" style={styles.fill} onLoad={() => setLoading(false)} onError={() => { setLoading(false); setError(true); }} />}{loading && <ActivityIndicator color={colors.systemBlue} style={styles.overlay} />}</View>;
}
function VideoPreview({ uri }: { uri: string }) {
  const colors = usePalette();
  const player = useVideoPlayer(uri);
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  return <View style={styles.fill}>{status === 'error' ? <Message text={error?.message ?? 'This video could not be played on your device.'} /> : <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} style={styles.fill} />}{status === 'loading' && <ActivityIndicator color={colors.systemBlue} style={styles.overlay} />}</View>;
}
const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
function AudioPreview({ uri }: { uri: string }) {
  const colors = usePalette();
  const player = useAudioPlayer(uri, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState<string | null>(null);
  async function seek(seconds: number) { try { await player.seekTo(Math.max(0, Math.min(status.duration, seconds))); setError(null); } catch { setError('Could not seek in this audio file.'); } }
  async function toggle() { try { if (status.playing) player.pause(); else { if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) await player.seekTo(0); player.play(); } setError(null); } catch { setError('Could not play this audio file.'); } }
  return <View style={styles.audio}>
    <View style={[styles.art, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios="waveform" android="graphic-eq" size={72} color={colors.systemBlue} /></View>
    {status.error ? <Message text="This audio file could not be played on your device." /> : !status.isLoaded ? <ActivityIndicator color={colors.systemBlue} /> : <>
      <ThemedText accessibilityLiveRegion="none" style={{ color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }}>{time(status.currentTime)} / {time(status.duration)}</ThemedText>
      <View style={styles.controls}><Pressable accessibilityRole="button" accessibilityLabel="Back 10 seconds" onPress={() => void seek(status.currentTime - 10)} style={styles.button}><UniversalIcon ios="gobackward.10" android="replay-10" size={30} color={colors.systemBlue} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'} onPress={() => void toggle()} style={[styles.play, { backgroundColor: colors.systemBlue }]}><UniversalIcon ios={status.playing ? 'pause.fill' : 'play.fill'} android={status.playing ? 'pause' : 'play-arrow'} size={36} color="#FFFFFF" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Forward 10 seconds" onPress={() => void seek(status.currentTime + 10)} style={styles.button}><UniversalIcon ios="goforward.10" android="forward-10" size={30} color={colors.systemBlue} /></Pressable></View>
    </>}{error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
function Message({ text }: { text: string }) { return <View style={styles.message}><ThemedText style={{ textAlign: 'center' }}>{text}</ThemedText></View>; }
const styles = StyleSheet.create({ fill: { flex: 1 }, overlay: { ...StyleSheet.absoluteFill }, audio: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 }, art: { width: 160, height: 160, borderRadius: 32, alignItems: 'center', justifyContent: 'center' }, controls: { flexDirection: 'row', alignItems: 'center', gap: 24 }, button: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }, play: { width: 68, height: 68, borderRadius: 34, justifyContent: 'center', alignItems: 'center' }, message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 } });
