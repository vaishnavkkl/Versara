import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { requestThumbnail } from '@/features/files/thumbnail-cache';
import type { FileKind } from '@/features/files/recent-files';

const icons = { pdf: ['doc.richtext', 'picture-as-pdf'], image: ['photo', 'image'], video: ['play.rectangle', 'smart-display'], audio: ['waveform', 'graphic-eq'] } as const;
export function FileThumbnail({ uri, kind, page = 0, active = true }: { uri: string; kind: FileKind; page?: number; active?: boolean }) {
  const colors = usePalette();
  const [thumbnail, setThumbnail] = useState<{ source: string; page: number; uri: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!active || kind === 'image') return;
    let current = true;
    const request = requestThumbnail(uri, kind, page);
    void request.promise.then(result => { if (current && result) setThumbnail({ source: uri, page, uri: result }); });
    return () => { current = false; request.release(); };
  }, [uri, kind, page, active]);
  const image = kind === 'image' ? uri : thumbnail?.source === uri && thumbnail.page === page ? thumbnail.uri : null;
  return <View style={[styles.box, { backgroundColor: colors.accentSurface }]}>
    {active && image && failed !== image ? <Image source={{ uri: image }} cachePolicy="none" recyclingKey={image} contentFit={kind === 'pdf' ? 'contain' : 'cover'} style={StyleSheet.absoluteFill} onError={() => setFailed(image)} /> : <UniversalIcon ios={icons[kind][0]} android={icons[kind][1]} size={26} color={colors.systemBlue} />}
  </View>;
}
const styles = StyleSheet.create({ box: { flex: 1, width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' } });
