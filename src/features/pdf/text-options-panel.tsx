import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ColorSwatches } from '@/components/color-swatches';
import { TextStyleControls, type TextStyle } from '@/components/text-style-controls';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';

type Props = {
  style: TextStyle;
  onStyleChange: (style: TextStyle) => void;
  size: string;
  onSizeChange: (size: string) => void;
  indent: number;
  indentStep: number;
  onIndentChange: (indent: number) => void;
  allowOriginal: boolean;
  ink: number | null;
  onInkChange: (ink: number | null) => void;
  originalInk?: { label: string; value: null };
  note?: string;
  disabled?: boolean;
  onClose: () => void;
};

/**
 * Font, emphasis and colour above the page so style changes stay visible on the live preview.
 * A bottom sheet would cover the text being edited.
 */
export function TextOptionsPanel({
  style, onStyleChange, size, onSizeChange, indent, indentStep, onIndentChange, allowOriginal,
  ink, onInkChange, originalInk, note, disabled, onClose,
}: Props) {
  const colors = usePalette();
  const { height } = useWindowDimensions();
  const maxBody = Math.max(160, Math.min(280, Math.round(height * 0.34)));
  return <View style={[styles.panel, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>
    <View style={styles.header}>
      <UniversalIcon ios="textformat" android="text-format" size={18} color={colors.systemBlue} />
      <View style={styles.grow}>
        <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Text options</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>Colour and style update on the page as you change them</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Done with text options" onPress={onClose} hitSlop={4}
        style={({ pressed }) => [styles.done, { backgroundColor: colors.accentSurface, opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText style={[styles.doneLabel, { color: colors.systemBlue }]}>Done</ThemedText>
      </Pressable>
    </View>
    <ScrollView style={{ maxHeight: maxBody }} keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
      <TextStyleControls style={style} onChange={onStyleChange} size={size} onSizeChange={onSizeChange} sizeUnit="pt" minSize={4} maxSize={200}
        allowOriginal={allowOriginal} disabled={disabled} indent={indent} indentStep={indentStep} onIndentChange={onIndentChange} />
      {!!note && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{note}</ThemedText>}
      <View style={styles.colour}>
        <ThemedText style={[styles.section, { color: colors.secondaryLabel }]}>Colour</ThemedText>
        <ColorSwatches value={ink} disabled={disabled} original={originalInk} onChange={onInkChange} />
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17 },
  done: { minWidth: 64, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  doneLabel: { fontSize: 15, fontWeight: '700' },
  body: { gap: 12, paddingBottom: 4 },
  colour: { gap: 8 },
  section: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
});
