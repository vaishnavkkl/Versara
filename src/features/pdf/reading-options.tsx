import { StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { PdfEngine } from '../../../modules/pdf-engine';
import { useReadingPreferences } from './reading-preferences';

type Icon = React.ComponentProps<typeof UniversalIcon>;
type Choice<T extends string> = { value: T; label: string; ios: Icon['ios']; android: Icon['android'] };

/** Older native builds can't show spreads or right-to-left order; those choices say so instead of doing nothing. */
export const readingLayoutAvailable = () => !!PdfEngine?.nativeReaderLayoutVersion;

function Segmented<T extends string>({ label, value, choices, disabled, compact = false, onChange }: { label: string; value: T; choices: Choice<T>[]; disabled?: boolean; compact?: boolean; onChange: (value: T) => void }) {
  const colors = usePalette();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, { backgroundColor: colors.fieldSurface, opacity: disabled ? 0.45 : 1 }]}>
    {choices.map(choice => {
      const selected = choice.value === value;
      return <Pressable key={choice.value} accessibilityRole="radio" accessibilityLabel={choice.label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(choice.value)}
        style={({ pressed }) => [styles.segment, compact && styles.compactSegment, selected && [styles.selected, { backgroundColor: colors.catalogSurface, borderColor: colors.catalogBorder }], { opacity: pressed ? 0.7 : 1 }]}>
        <UniversalIcon ios={choice.ios} android={choice.android} size={compact ? 16 : 18} color={selected ? colors.label : colors.secondaryLabel} />
        <ThemedText numberOfLines={1} style={[styles.segmentLabel, { color: selected ? colors.label : colors.secondaryLabel, fontWeight: selected ? '700' : '500' }]}>{choice.label}</ThemedText>
      </Pressable>;
    })}
  </View>;
}

/** The reader's display choices in a short panel above the page, so each change shows on the PDF straight away. */
export function ReadingOptionsPanel({ onClose, landscape, thumbnails }: { onClose: () => void; landscape: boolean; thumbnails: { visible: boolean; onChange: (visible: boolean) => void } }) {
  const colors = usePalette();
  const { scroll, layout, direction, set } = useReadingPreferences();
  const layoutAvailable = readingLayoutAvailable();
  const note = !layoutAvailable ? 'Page layout and direction need an app update with the latest PDF reader.' : landscape ? 'Landscape shows one page at a time.' : null;
  const row = (label: string, control: React.ReactNode) => <View style={styles.panelRow}>
    <ThemedText numberOfLines={1} style={[styles.rowLabel, { color: colors.secondaryLabel }]}>{label}</ThemedText>
    <View style={styles.grow}>{control}</View>
  </View>;
  return <View style={[styles.panel, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>
    <View style={styles.panelHeader}>
      <UniversalIcon ios="eye" android="visibility" size={18} color={colors.systemBlue} />
      <View style={styles.grow}>
        <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Reading options</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.caption, { color: colors.secondaryLabel }]}>Changes show on the page and are remembered</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Done with reading options" onPress={onClose} hitSlop={4}
        style={({ pressed }) => [styles.done, { backgroundColor: colors.accentSurface, opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText style={[styles.doneLabel, { color: colors.systemBlue }]}>Done</ThemedText>
      </Pressable>
    </View>
    <View style={styles.panelRows}>
      {row('Scrolling', <Segmented compact label="Scrolling" value={scroll} disabled={landscape} onChange={value => set({ scroll: value })} choices={[
        { value: 'continuous', label: 'Continuous', ios: 'arrow.up.arrow.down', android: 'swap-vert' },
        { value: 'page', label: 'One page', ios: 'doc', android: 'crop-portrait' },
      ]} />)}
      {row('Layout', <Segmented compact label="Page layout" value={layout} disabled={!layoutAvailable} onChange={value => set({ layout: value })} choices={[
        { value: 'single', label: 'Single', ios: 'rectangle.portrait', android: 'crop-portrait' },
        { value: 'double', label: 'Two pages', ios: 'book', android: 'auto-stories' },
      ]} />)}
      {row('Direction', <Segmented compact label="Reading direction" value={direction} disabled={!layoutAvailable} onChange={value => set({ direction: value })} choices={[
        { value: 'ltr', label: 'Left to right', ios: 'arrow.right', android: 'arrow-forward' },
        { value: 'rtl', label: 'Right to left', ios: 'arrow.left', android: 'arrow-back' },
      ]} />)}
      {row('Thumbnails', <Segmented compact label="Page thumbnails" value={thumbnails.visible ? 'show' : 'hide'} onChange={value => thumbnails.onChange(value === 'show')} choices={[
        { value: 'show', label: 'Show', ios: 'eye', android: 'visibility' },
        { value: 'hide', label: 'Hide', ios: 'eye.slash', android: 'visibility-off' },
      ]} />)}
    </View>
    {note && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{note}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17 },
  segments: { flexDirection: 'row', borderRadius: 14, borderCurve: 'continuous', padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 44, borderRadius: 11, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  selected: { boxShadow: '0 1px 3px rgba(16, 22, 67, 0.12)' },
  segmentLabel: { fontSize: 13, lineHeight: 18 },
  compactSegment: { minHeight: 36 },
  panel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10, gap: 8 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  panelRows: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 },
  panelRow: { flexGrow: 1, flexBasis: 300, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { width: 78, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  done: { minWidth: 64, minHeight: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  doneLabel: { fontSize: 15, fontWeight: '700' },
});
