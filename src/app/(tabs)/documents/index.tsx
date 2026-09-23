import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { colors } from '@/theme/colors';

const PDF_TOOLS = [
  { id: 'viewer',    title: 'PDF Viewer',     subtitle: 'Open & read PDFs',            ios: 'doc.text.magnifyingglass' as const, android: 'find-in-page' as const },
  { id: 'merge',     title: 'Merge PDF',      subtitle: 'Combine multiple PDFs',       ios: 'doc.on.doc' as const,               android: 'file-copy' as const },
  { id: 'split',     title: 'Split PDF',      subtitle: 'Split into separate pages',   ios: 'scissors' as const,                 android: 'content-cut' as const },
  { id: 'compress',  title: 'Compress PDF',   subtitle: 'Reduce file size',            ios: 'doc.zipper' as const,               android: 'picture-as-pdf' as const },
  { id: 'convert',   title: 'PDF to Image',   subtitle: 'Export pages as JPG/PNG',     ios: 'photo.badge.arrow.down' as const,   android: 'image' as const },
  { id: 'imgpdf',    title: 'Image to PDF',   subtitle: 'Convert JPG/PNG/HEIC',        ios: 'photo.on.rectangle' as const,       android: 'add-photo-alternate' as const },
  { id: 'rotate',    title: 'Rotate Pages',   subtitle: 'Rotate selected pages',       ios: 'rotate.right' as const,             android: 'rotate-right' as const },
  { id: 'info',      title: 'PDF Info',       subtitle: 'Inspect metadata & details',  ios: 'info.circle' as const,              android: 'info' as const },
] as const;

export default function DocumentsScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Documents',
          headerLargeTitleEnabled: true,
          headerSearchBarOptions: { placeholder: 'Search PDF tools…' },
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        style={{ backgroundColor: colors.systemBackground }}
      >
        <ThemedText style={styles.sectionLabel}>PDF Tools</ThemedText>
        <View style={styles.list}>
          {PDF_TOOLS.map((tool, i) => (
            <View
              key={tool.id}
              style={[
                styles.row,
                { backgroundColor: colors.secondarySystemBackground },
                i === 0 && styles.rowFirst,
                i === PDF_TOOLS.length - 1 && styles.rowLast,
              ]}
            >
              <View style={[styles.iconBubble, { backgroundColor: colors.systemBackground }]}>
                <UniversalIcon ios={tool.ios} android={tool.android} size={20} color={colors.systemBlue as string} />
              </View>
              <View style={styles.rowText}>
                <ThemedText style={styles.rowTitle}>{tool.title}</ThemedText>
                <ThemedText style={[styles.rowSub, { color: colors.secondaryLabel as string }]}>{tool.subtitle}</ThemedText>
              </View>
              <UniversalIcon ios="chevron.right" android="chevron-right" size={16} color={colors.secondaryLabel as string} />
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  sectionLabel: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  list: { borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', gap: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowFirst: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  iconBubble: { width: 38, height: 38, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 1 },
});
