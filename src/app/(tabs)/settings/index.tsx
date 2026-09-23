import React from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { colors } from '@/theme/colors';

const SETTINGS_GROUPS = [
  {
    title: 'Privacy',
    items: [
      { id: 'local_processing', title: 'Local Processing', subtitle: 'Files never leave your device', ios: 'lock.shield.fill' as const, android: 'security' as const },
      { id: 'no_uploads', title: 'No File Uploads', subtitle: 'Zero cloud processing', ios: 'icloud.slash' as const, android: 'cloud-off' as const },
      { id: 'no_account', title: 'No Account Required', subtitle: 'Use anonymously forever', ios: 'person.slash' as const, android: 'no-accounts' as const },
    ],
  },
  {
    title: 'AI Model',
    items: [
      { id: 'ai_model', title: 'Local AI Model', subtitle: 'Download & manage on-device AI', ios: 'brain' as const, android: 'memory' as const },
      { id: 'ai_enabled', title: 'AI Features', subtitle: 'Enable contextual AI assistance', ios: 'wand.and.stars' as const, android: 'auto-awesome' as const },
    ],
  },
  {
    title: 'Storage',
    items: [
      { id: 'history', title: 'Processing History', subtitle: 'View & clear job history', ios: 'clock.arrow.circlepath' as const, android: 'history' as const },
      { id: 'temp_files', title: 'Temp Files', subtitle: 'Clean up temporary output files', ios: 'trash' as const, android: 'delete-sweep' as const },
    ],
  },
  {
    title: 'Appearance',
    items: [
      { id: 'theme', title: 'Appearance', subtitle: 'System, Light or Dark', ios: 'circle.lefthalf.filled' as const, android: 'brightness-6' as const },
    ],
  },
] as const;

export default function SettingsScreen() {
  const isDark = useColorScheme() === 'dark';

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerLargeTitleEnabled: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        style={{ backgroundColor: colors.systemBackground }}
      >
        {/* Privacy banner */}
        <View style={[styles.banner, { backgroundColor: '#FC8019' }]}>
          <UniversalIcon ios="lock.shield.fill" android="security" size={22} color="#fff" />
          <ThemedText style={styles.bannerText}>
            Your files are processed locally.{'\n'}Nothing is ever uploaded.
          </ThemedText>
        </View>

        {SETTINGS_GROUPS.map(group => (
          <View key={group.title} style={styles.section}>
            <ThemedText style={styles.sectionLabel}>{group.title}</ThemedText>
            <View style={styles.list}>
              {group.items.map((item, i) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.row,
                    { backgroundColor: colors.secondarySystemBackground },
                    i === 0 && styles.rowFirst,
                    i === group.items.length - 1 && styles.rowLast,
                  ]}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconBubble, { backgroundColor: colors.systemBackground }]}>
                    <UniversalIcon ios={item.ios} android={item.android} size={18} color={colors.systemBlue as string} />
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.rowTitle}>{item.title}</ThemedText>
                    <ThemedText style={[styles.rowSub, { color: colors.secondaryLabel as string }]}>{item.subtitle}</ThemedText>
                  </View>
                  <UniversalIcon ios="chevron.right" android="chevron-right" size={14} color={colors.secondaryLabel as string} />
                </TouchableOpacity>
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
  banner: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16, borderCurve: 'continuous' },
  bannerText: { flex: 1, color: '#fff', fontWeight: '600', fontSize: 13, lineHeight: 18 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  list: { borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', gap: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowFirst: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  iconBubble: { width: 36, height: 36, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 1 },
});
