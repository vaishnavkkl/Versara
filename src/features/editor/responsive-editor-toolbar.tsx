import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { spacing, typography } from '@/theme/dashboard';

const GAP = 8;
type Measurement = { key: string; widths: Record<string, number> };

/** Measures inert equivalents, never duplicate interactive buttons. The sizing mirrors
 * compact EditorOption and ToolButton; location changes cannot change these probes. */
export function useResponsiveEditorToolbar(options: (string | number)[], buttons: string[], iconButtons = 0) {
  const { fontScale } = useWindowDimensions();
  const key = JSON.stringify([fontScale, options, buttons, iconButtons]);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [measurement, setMeasurement] = useState<Measurement>({ key: '', widths: {} });
  const currentKey = useRef(key);
  useLayoutEffect(() => { currentKey.current = key; }, [key]);
  const onBottomLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.floor(event.nativeEvent.layout.width);
    setAvailableWidth(current => current === width ? current : width);
  }, []);
  const entries = [
    ...options.map((label, index) => ({ id: `option:${index}`, label: typeof label === 'string' ? label : '', width: typeof label === 'number' ? label : undefined, compact: true })),
    ...buttons.map((label, index) => ({ id: `button:${index}`, label, width: undefined, compact: false })),
  ];
  // Retain the last measured widths until replacement probes report. A changing
  // annotation count must not reset a crowded toolbar to bottom on every stroke.
  const widths = measurement.widths;
  const measured = entries.every(entry => widths[entry.id] > 0);
  const toolsWidth = options.reduce<number>((sum, _, index) => sum + (widths[`option:${index}`] ?? 0), 0) + Math.max(0, options.length - 1) * GAP;
  const requiredWidth = buttons.reduce((sum, _, index) => sum + (widths[`button:${index}`] ?? 0), 0) + iconButtons * 44 + Math.max(0, buttons.length + iconButtons - 1) * GAP;
  // Begin at the bottom. Probes and footer geometry stay unchanged when actions move,
  // so the decision does not oscillate as the flexible Save button grows or shrinks.
  const atBottom = !measured || !availableWidth || Math.ceil(toolsWidth + requiredWidth + GAP) <= availableWidth;
  const primaryMinWidth = Math.min(availableWidth, widths[`button:${buttons.length - 1}`] ?? 0);
  const measurements = <View key={key} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.probes}>
    {entries.map(entry => <View key={entry.id} style={[styles.probe, entry.compact ? styles.compactProbe : styles.buttonProbe, entry.width !== undefined && { width: entry.width }]} onLayout={event => {
      if (currentKey.current !== key) return;
      const width = Math.ceil(event.nativeEvent.layout.width);
      setMeasurement(current => {
        return current.key === key && current.widths[entry.id] === width ? current : { key, widths: { ...current.widths, [entry.id]: width } };
      });
    }}>
      <View style={styles.symbol} />
      {!!entry.label && <ThemedText style={entry.compact ? styles.compactText : styles.buttonText}>{entry.label}</ThemedText>}
    </View>)}
  </View>;
  return { atBottom, onBottomLayout, primaryMinWidth, measurements };
}

export const responsiveToolbarStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: GAP },
  tools: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: GAP, maxWidth: '100%', flexShrink: 1 },
  primary: { flexGrow: 1, flexBasis: 0 },
});

const styles = StyleSheet.create({
  probes: { position: 'absolute', opacity: 0, left: 0, top: 0, alignItems: 'flex-start' },
  probe: { alignSelf: 'flex-start', flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  compactProbe: { minWidth: 44, paddingHorizontal: 5, borderWidth: StyleSheet.hairlineWidth },
  buttonProbe: { flexDirection: 'row', gap: 7, paddingHorizontal: spacing.md },
  symbol: { width: 20, height: 20 },
  compactText: { fontSize: 10 },
  buttonText: { ...typography.label, textAlign: 'center' },
});
