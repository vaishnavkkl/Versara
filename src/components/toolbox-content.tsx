import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { ToolGrid, type ToolSection } from './tool-grid';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';

export type ToolboxProps = {
  visible: boolean;
  title: string;
  subtitle: string;
  caption?: string;
  sections: ToolSection[];
  footer: ReactElement;
  onClose: () => void;
  /** Runs after the sheet has finished closing, so tools never open over a dismissing sheet. */
  onAction: (id: string) => void;
};

type ContentProps = Omit<ToolboxProps, 'visible' | 'onAction'> & { onSelect: (id: string) => void };

export function ToolboxContent({ title, subtitle, caption, sections, footer, onClose, onSelect }: ContentProps) {
  const colors = usePalette();
  return <View style={[styles.sheet, { backgroundColor: colors.systemBackground }]}>
    <View style={[styles.header, { borderColor: colors.separator }]}>
      <View style={[styles.badge, getGradients(colors).module]}><UniversalIcon ios="wrench.and.screwdriver" android="handyman" size={20} color={colors.moduleText} /></View>
      <View style={styles.grow}>
        <ThemedText accessibilityRole="header" style={styles.title}>{title}</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.body, { color: colors.secondaryLabel }]}>{subtitle}</ThemedText>
        {!!caption && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{caption}</ThemedText>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: colors.accentSurface, opacity: pressed ? 0.7 : 1 }]}>
        <UniversalIcon ios="xmark" android="close" size={22} color={colors.systemBlue} />
      </Pressable>
    </View>
    <ToolGrid sections={sections} onAction={onSelect} footer={footer} />
  </View>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: s.md, paddingHorizontal: s.xl, paddingVertical: s.md, borderBottomWidth: StyleSheet.hairlineWidth },
  badge: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { ...t.heading, fontSize: 20, lineHeight: 26 },
  body: { ...t.body },
  caption: { ...t.caption },
  close: { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
