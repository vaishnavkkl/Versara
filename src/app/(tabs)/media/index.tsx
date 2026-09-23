import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { colors } from '@/theme/colors';

const MEDIA_SECTIONS = [
  {
    title: 'Image Tools',
    tools: [
      { id: 'img_compress', title: 'Compress Image',   subtitle: 'Target size or quality',    ios: 'photo.badge.arrow.down' as const,  android: 'photo-size-select-large' as const },
      { id: 'img_resize',   title: 'Resize Image',     subtitle: 'Pixels, percentage, presets', ios: 'arrow.up.left.and.arrow.down.right' as const, android: 'photo-size-select-actual' as const },
      { id: 'img_convert',  title: 'Convert Format',   subtitle: 'JPG, PNG, WebP, HEIC',     ios: 'arrow.2.squarepath' as const,      android: 'swap-horiz' as const },
      { id: 'img_metadata', title: 'Remove Metadata',  subtitle: 'Strip EXIF & GPS data',     ios: 'xmark.seal' as const,              android: 'remove-circle' as const },
      { id: 'img_pdf',      title: 'Images to PDF',    subtitle: 'Combine images into PDF',   ios: 'doc.badge.plus' as const,          android: 'post-add' as const },
    ],
  },
  {
    title: 'Video Tools',
    tools: [
      { id: 'vid_compress', title: 'Compress Video',   subtitle: 'Target MB or quality preset', ios: 'video.badge.checkmark' as const, android: 'video-settings' as const },
      { id: 'vid_trim',     title: 'Trim Video',       subtitle: 'Cut start & end points',   ios: 'scissors' as const,                android: 'content-cut' as const },
      { id: 'vid_convert',  title: 'Convert Resolution', subtitle: '4K, 1080p, 720p',        ios: 'arrow.2.squarepath' as const,      android: 'hd' as const },
      { id: 'vid_mute',     title: 'Mute Video',       subtitle: 'Remove audio track',        ios: 'speaker.slash' as const,           android: 'volume-off' as const },
    ],
  },
] as const;

export default function MediaScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Media',
          headerLargeTitleEnabled: true,
          headerSearchBarOptions: { placeholder: 'Search media tools…' },
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        style={{ backgroundColor: colors.systemBackground }}
      >
        {MEDIA_SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <ThemedText style={styles.sectionLabel}>{section.title}</ThemedText>
            <View style={styles.list}>
              {section.tools.map((tool, i) => (
                <View
                  key={tool.id}
                  style={[
                    styles.row,
                    { backgroundColor: colors.secondarySystemBackground },
                    i === 0 && styles.rowFirst,
                    i === section.tools.length - 1 && styles.rowLast,
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
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 24 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  list: { borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', gap: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowFirst: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  iconBubble: { width: 38, height: 38, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 1 },
});
