import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { showDialog } from '@/components/app-dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/screen-header';
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
  const [focused, setFocused] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
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
  function leave() { Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/(tabs)/documents'); }
  function close() {
    if (!unsaved) { leave(); return; }
    Keyboard.dismiss();
    showDialog('Discard PDF edits?', 'Your text changes to this PDF have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: leave },
    ], { ios: 'exclamationmark.triangle', android: 'warning' });
  }
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!unsaved) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, [unsaved]);
  const tool = session?.tool;
  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.systemBackground }]} edges={['top', 'bottom', 'left', 'right']}>
    <Stack.Screen options={{ gestureEnabled: !unsaved }} />
    {!focused && <ScreenHeader title={session?.title ?? 'PDF'} onBack={close}><HelpButton tool={tool} /></ScreenHeader>}
    {!session ? <View style={styles.empty}><ThemedText>Select a file from the PDF tools to get started.</ThemedText><ToolButton title="Back to PDF tools" onPress={close} /></View>
      : tool === 'viewer' ? <PdfViewer initialDocument={session.files[0]} onFocusChange={setFocused} />
      : tool === 'edit_text' || tool === 'remove_text' || tool === 'text' ? <PdfTextEditor initialSelection={session} onUnsavedChange={setUnsaved} initialMode={tool === 'text' ? 'add' : tool === 'remove_text' ? 'delete' : 'edit'} />
      : tool === 'merge' || tool === 'split' ? <OrganizePdf operation={tool} initialSelection={session} />
      : tool === 'extract' || tool === 'delete' ? <EditPdfPages operation={tool} initialSelection={session} />
      : tool === 'reorder' || tool === 'rotate' ? <ArrangePdfPages operation={tool} initialSelection={session} />
      : <ImageToPdf initialSelection={session} />}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, empty: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
});
