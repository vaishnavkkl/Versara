import { StyleSheet, View } from 'react-native';
import { AppBottomSheet } from '@/components/app-bottom-sheet';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import { PdfEngine } from '../../../modules/pdf-engine';
import { useReadingPreferences } from './reading-preferences';

type Icon = React.ComponentProps<typeof UniversalIcon>;
type Choice<T extends string> = { value: T; label: string; ios: Icon['ios']; android: Icon['android'] };

/** Older native builds can't show spreads or right-to-left order; those choices say so instead of doing nothing. */
export const readingLayoutAvailable = () => !!PdfEngine?.nativeReaderLayoutVersion;

function Segmented<T extends string>({ label, value, choices, disabled, onChange }: { label: string; value: T; choices: Choice<T>[]; disabled?: boolean; onChange: (value: T) => void }) {
  const colors = usePalette();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, { backgroundColor: colors.fieldSurface, opacity: disabled ? 0.45 : 1 }]}>
    {choices.map(choice => {
      const selected = choice.value === value;
      return <Pressable key={choice.value} accessibilityRole="radio" accessibilityLabel={choice.label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(choice.value)}
        style={({ pressed }) => [styles.segment, selected && [styles.selected, { backgroundColor: colors.catalogSurface, borderColor: colors.catalogBorder }], { opacity: pressed ? 0.7 : 1 }]}>
        <UniversalIcon ios={choice.ios} android={choice.android} size={18} color={selected ? colors.label : colors.secondaryLabel} />
        <ThemedText numberOfLines={1} style={[styles.segmentLabel, { color: selected ? colors.label : colors.secondaryLabel, fontWeight: selected ? '700' : '500' }]}>{choice.label}</ThemedText>
      </Pressable>;
    })}
  </View>;
}

function Group({ colorKey, icon, title, caption, children }: { colorKey: string; icon: { ios: Icon['ios']; android: Icon['android'] }; title: string; caption: string; children: React.ReactNode }) {
  const colors = usePalette();
  const tint = toolColors(colorKey, colors);
  return <View style={styles.group}>
    <View style={styles.heading}>
      <View style={[styles.badge, tint.fill]}><UniversalIcon {...icon} size={17} color={tint.glyph} /></View>
      <View style={styles.grow}>
        <ThemedText style={[styles.title, { color: colors.label }]}>{title}</ThemedText>
        <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{caption}</ThemedText>
      </View>
    </View>
    {children}
  </View>;
}

/**
 * Scrolling, page layout and reading direction, plus page thumbnails when shown inside the reader.
 * `landscape` readers always show one page at a time, so scrolling is fixed there.
 */
export function ReadingOptions({ landscape = false, thumbnails }: { landscape?: boolean; thumbnails?: { visible: boolean; onChange: (visible: boolean) => void } }) {
  const { scroll, layout, direction, set } = useReadingPreferences();
  const layoutAvailable = readingLayoutAvailable();
  const unavailable = 'Needs an app update with the latest PDF reader.';
  return <View style={styles.options}>
    <Group colorKey="scroll" icon={{ ios: 'arrow.up.arrow.down', android: 'swap-vert' }} title="Scrolling" caption={landscape ? 'Landscape shows one page at a time.' : scroll === 'continuous' ? 'Swipe up and down through every page.' : 'One page at a time. Swipe sideways to turn pages.'}>
      <Segmented label="Scrolling" value={scroll} disabled={landscape} onChange={value => set({ scroll: value })} choices={[
        { value: 'continuous', label: 'Continuous', ios: 'arrow.up.arrow.down', android: 'swap-vert' },
        { value: 'page', label: 'One page', ios: 'doc', android: 'crop-portrait' },
      ]} />
    </Group>
    <Group colorKey="layout" icon={{ ios: 'book', android: 'auto-stories' }} title="Page layout" caption={layoutAvailable ? layout === 'double' ? 'Two pages side by side, like an open book. Best in landscape.' : 'One page across the screen.' : unavailable}>
      <Segmented label="Page layout" value={layout} disabled={!layoutAvailable} onChange={value => set({ layout: value })} choices={[
        { value: 'single', label: 'Single', ios: 'rectangle.portrait', android: 'crop-portrait' },
        { value: 'double', label: 'Two pages', ios: 'book', android: 'auto-stories' },
      ]} />
    </Group>
    <Group colorKey="direction" icon={{ ios: 'arrow.left.arrow.right', android: 'swap-horiz' }} title="Reading direction" caption={layoutAvailable ? direction === 'rtl' ? 'For Arabic, Hebrew, Urdu and manga: pages turn from right to left.' : 'Pages turn from left to right.' : unavailable}>
      <Segmented label="Reading direction" value={direction} disabled={!layoutAvailable} onChange={value => set({ direction: value })} choices={[
        { value: 'ltr', label: 'Left to right', ios: 'arrow.right', android: 'arrow-forward' },
        { value: 'rtl', label: 'Right to left', ios: 'arrow.left', android: 'arrow-back' },
      ]} />
    </Group>
    {thumbnails && <Group colorKey="thumbnails" icon={{ ios: 'rectangle.split.3x1', android: 'view-carousel' }} title="Page thumbnails" caption="The strip of small pages under the reader.">
      <Segmented label="Page thumbnails" value={thumbnails.visible ? 'show' : 'hide'} onChange={value => thumbnails.onChange(value === 'show')} choices={[
        { value: 'show', label: 'Show', ios: 'eye', android: 'visibility' },
        { value: 'hide', label: 'Hide', ios: 'eye.slash', android: 'visibility-off' },
      ]} />
    </Group>}
  </View>;
}

/** The reader's View options: one sheet for every display choice, so they never crowd the tools. */
export function ReadingOptionsSheet({ visible, onClose, landscape, thumbnails }: { visible: boolean; onClose: () => void; landscape: boolean; thumbnails: { visible: boolean; onChange: (visible: boolean) => void } }) {
  return <AppBottomSheet visible={visible} onClose={onClose} title="Reading options" subtitle="Remembered for every PDF you read" icon={{ ios: 'eye', android: 'visibility' }}>
    <ReadingOptions landscape={landscape} thumbnails={thumbnails} />
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  options: { gap: 18, paddingVertical: 4 },
  group: { gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 32, height: 32, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17 },
  segments: { flexDirection: 'row', borderRadius: 14, borderCurve: 'continuous', padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 44, borderRadius: 11, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  selected: { boxShadow: '0 1px 3px rgba(16, 22, 67, 0.12)' },
  segmentLabel: { fontSize: 13, lineHeight: 18 },
});
