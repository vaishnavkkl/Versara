import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { HelpButton } from '@/components/help-button';
import { ToolButton } from '@/components/tool-button';
import { usePalette } from '@/theme/colors';
import { PdfViewer } from '@/features/pdf/pdf-viewer';
import { PdfTextEditor } from '@/features/pdf/pdf-text-editor';
import { OrganizePdf } from '@/features/pdf/organize-pdf';
import { EditPdfPages } from '@/features/pdf/edit-pdf-pages';
import { ArrangePdfPages } from '@/features/pdf/arrange-pdf-pages';
import { ImageToPdf } from '@/features/pdf/image-to-pdf';
import { disposeImports } from '@/features/files/file-storage';
import { forgetPdfToolSession, getPdfToolSession } from '@/features/pdf/pdf-tool-session';

export default function PdfToolScreen() {
  const { session: id } = useLocalSearchParams<{ session: string }>();
  const [session] = useState(() => getPdfToolSession(id));
  const colors = usePalette();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        forgetPdfToolSession(id);
        // The processing tools defer cleanup until their native jobs finish.
        if (session?.tool === 'viewer') disposeImports(session.directory);
      });
    };
  }, [id, session]);
  function close() { Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/(tabs)/documents'); }
  const tool = session?.tool;
  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'bottom', 'left', 'right']}>
    <View style={[styles.header, { borderColor: colors.separator }]}>
      <ThemedText numberOfLines={1} style={styles.title}>{session?.title ?? 'PDF'}</ThemedText>
      <HelpButton tool={tool} />
      <Pressable accessibilityRole="button" accessibilityLabel="Close PDF tool" onPress={close} style={[styles.close, { backgroundColor: colors.navBackground }]}><UniversalIcon ios="xmark" android="close" size={24} color={colors.navIcon} /></Pressable>
    </View>
    {!session ? <View style={styles.empty}><ThemedText>Select a file from the PDF tools to get started.</ThemedText><ToolButton title="Back to PDF tools" onPress={close} /></View>
      : tool === 'viewer' ? <PdfViewer initialDocument={session.files[0]} />
      : tool === 'edit_text' || tool === 'remove_text' || tool === 'text' ? <PdfTextEditor initialSelection={session} initialMode={tool === 'text' ? 'add' : tool === 'remove_text' ? 'delete' : 'edit'} />
      : tool === 'merge' || tool === 'split' ? <OrganizePdf operation={tool} initialSelection={session} />
      : tool === 'extract' || tool === 'delete' ? <EditPdfPages operation={tool} initialSelection={session} />
      : tool === 'reorder' || tool === 'rotate' ? <ArrangePdfPages operation={tool} initialSelection={session} />
      : <ImageToPdf initialSelection={session} />}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { minHeight: 48, paddingTop: 2, paddingBottom: 2, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 17, fontWeight: '600' }, close: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, empty: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
});
