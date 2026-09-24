import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { ToolButton } from '@/components/tool-button';
import { AppearanceButtons } from '@/components/appearance-buttons';
import { usePalette } from '@/theme/colors';

export default function SettingsScreen() {
  const colors = usePalette();
  return <ScrollView style={{ backgroundColor: colors.systemBackground }} contentContainerStyle={styles.content}>
    <ThemedText accessibilityRole="header" style={styles.title}>Settings</ThemedText>
    <View style={styles.section}><ThemedText style={styles.heading}>Appearance</ThemedText><AppearanceButtons /><ThemedText style={{ color: colors.secondaryLabel }}>Your choice is remembered on this device.</ThemedText></View>
    <View style={styles.section}><ThemedText style={styles.heading}>Need a hand?</ThemedText><ToolButton title="Quick guide & practice demo" onPress={() => router.push('/guide')} /><ThemedText style={{ color: colors.secondaryLabel }}>Look for the question mark in a tool for short instructions.</ThemedText></View>
    <View style={[styles.note, { backgroundColor: colors.secondarySystemBackground }]}><UniversalIcon ios="lock.shield" android="security" size={24} color={colors.systemBlue} /><View style={styles.text}><ThemedText style={styles.heading}>On your device</ThemedText><ThemedText>File tools process locally. No account is needed. Edited files are saved as new copies.</ThemedText></View></View>
    <View style={styles.section}><ThemedText style={styles.heading}>Available tools</ThemedText><ThemedText style={{ color: colors.secondaryLabel }}>Open recent PDFs, images, videos and audio from each category. PDF editing, page tools and Image to PDF are ready. More editing tools are listed in Options as coming later.</ThemedText></View>
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 28, width: '100%', maxWidth: 720, alignSelf: 'center' }, title: { fontSize: 24, fontWeight: '600' }, heading: { fontSize: 17, fontWeight: '600' }, section: { gap: 12 }, note: { padding: 16, borderRadius: 16, flexDirection: 'row', gap: 12 }, text: { flex: 1, gap: 8 } });
