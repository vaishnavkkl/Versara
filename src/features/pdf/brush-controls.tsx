import { View } from 'react-native';
import { Host, Slider } from '@expo/ui';
import { ThemedText } from '@/components/themed-text';
import { EditorMenu } from '@/components/editor-menu';
import { useAppearance, usePalette } from '@/theme/colors';
export const BRUSHES = [
  { id: 'pen', label: 'Pen', colorKey: 'rotate', width: .005, opacity: 1 }, { id: 'pencil', label: 'Pencil', colorKey: 'resize', width: .0035, opacity: 200 / 255 },
  { id: 'marker', label: 'Marker', colorKey: 'draw', width: .018, opacity: 210 / 255 }, { id: 'highlighter', label: 'Highlighter', colorKey: 'compress', width: .025, opacity: .3 },
] as const;
export function BrushControls({ brush, pattern, onBrush, onPattern, disabled, patternsAvailable, opacity, onOpacity, erasing, onEraser, editingAvailable = false, showSelectors = true }: {
  brush: string; pattern: string; onBrush: (value: string, width: number, opacity: number) => void; onPattern: (value: string) => void; disabled?: boolean; patternsAvailable: boolean;
  opacity?: number; onOpacity?: (value: number) => void; erasing?: boolean; onEraser?: () => void; editingAvailable?: boolean;
  showSelectors?: boolean;
}) {
  const colors = usePalette(); const mode = useAppearance(state => state.mode);
  const selectedBrush = BRUSHES.find(item => item.id === brush);
  const strength = opacity ?? selectedBrush?.opacity ?? 1;
  return <>{showSelectors && <><View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
    <EditorMenu label={erasing ? 'Stroke eraser' : selectedBrush?.label ?? 'Brush'} colorKey={erasing ? 'redact' : selectedBrush?.colorKey} tintedItems grid={3} disabled={disabled} items={[
      ...BRUSHES.map(item => ({ id: item.id, label: item.label, colorKey: item.colorKey, selected: !erasing && brush === item.id, onPress: () => onBrush(item.id, item.width, item.opacity) })),
      ...(onEraser ? [{ id: 'eraser', label: 'Stroke eraser', colorKey: 'redact', selected: erasing, disabled: !editingAvailable, onPress: onEraser }] : []),
    ]} />
    <EditorMenu label={`${pattern[0].toUpperCase()}${pattern.slice(1)} stroke`} tintedItems grid={3} disabled={disabled} items={['solid', 'dashed', 'dotted'].map(value => ({ id: value, label: `${value[0].toUpperCase()}${value.slice(1)}`, selected: pattern === value, disabled: value !== 'solid' && !patternsAvailable, onPress: () => onPattern(value) }))} />
    </View>{!patternsAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to use dotted and dashed strokes.</ThemedText>}</>}
    {onOpacity && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ThemedText>Opacity</ThemedText><View style={{ flex: 1 }}><Host colorScheme={mode} seedColor={colors.accent} matchContents={{ vertical: true }}><Slider value={strength} min={.01} max={1} step={.01} disabled={disabled || erasing || !editingAvailable} onValueChange={onOpacity} /></Host></View><ThemedText style={{ minWidth: 40, fontVariant: ['tabular-nums'] }}>{Math.round(strength * 100)}%</ThemedText></View>}
    {onEraser && erasing && <ThemedText style={{ fontSize: 12 }}>Touch an ink stroke to remove the whole stroke. Undo restores it.</ThemedText>}
    {(onOpacity || onEraser) && !editingAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to change opacity or erase strokes.</ThemedText>}</>;
}
