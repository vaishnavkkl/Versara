import { View } from 'react-native';
import { Host, Slider } from '@expo/ui';
import { ThemedText } from '@/components/themed-text';
import { EditorOption } from '@/components/editor-option';
import { useAppearance, usePalette } from '@/theme/colors';
export const BRUSHES = [
  { id: 'pen', label: 'Pen', width: .005, opacity: 1 }, { id: 'pencil', label: 'Pencil', width: .002, opacity: 170 / 255 },
  { id: 'marker', label: 'Marker', width: .018, opacity: 210 / 255 }, { id: 'highlighter', label: 'Highlighter', width: .025, opacity: .3 },
] as const;
export function BrushControls({ brush, pattern, onBrush, onPattern, disabled, patternsAvailable, opacity, onOpacity, erasing, onEraser, editingAvailable = false }: {
  brush: string; pattern: string; onBrush: (value: string, width: number, opacity: number) => void; onPattern: (value: string) => void; disabled?: boolean; patternsAvailable: boolean;
  opacity?: number; onOpacity?: (value: number) => void; erasing?: boolean; onEraser?: () => void; editingAvailable?: boolean;
}) {
  const colors = usePalette(); const mode = useAppearance(state => state.mode);
  const strength = opacity ?? BRUSHES.find(item => item.id === brush)?.opacity ?? 1;
  return <><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{BRUSHES.map(item => <EditorOption key={item.id} label={item.label} selected={!erasing && brush === item.id} disabled={disabled} onPress={() => onBrush(item.id, item.width, item.opacity)} />)}{onEraser && <EditorOption label="Stroke eraser" icon={{ ios: 'eraser', android: 'auto-fix-normal' }} selected={erasing} disabled={disabled || !editingAvailable} onPress={onEraser} />}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['solid', 'dashed', 'dotted'].map(value => <EditorOption key={value} label={`${value[0].toUpperCase()}${value.slice(1)}`} selected={pattern === value} disabled={disabled || (value !== 'solid' && !patternsAvailable)} onPress={() => onPattern(value)} />)}</View>{!patternsAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to use dotted and dashed strokes.</ThemedText>}
    {onOpacity && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ThemedText>Opacity</ThemedText><View style={{ flex: 1 }}><Host colorScheme={mode} seedColor={colors.accent} matchContents={{ vertical: true }}><Slider value={strength} min={.01} max={1} step={.01} disabled={disabled || erasing || !editingAvailable} onValueChange={onOpacity} /></Host></View><ThemedText style={{ minWidth: 40, fontVariant: ['tabular-nums'] }}>{Math.round(strength * 100)}%</ThemedText></View>}
    {onEraser && erasing && <ThemedText style={{ fontSize: 12 }}>Touch an ink stroke to remove the whole stroke. Undo restores it.</ThemedText>}
    {(onOpacity || onEraser) && !editingAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to change opacity or erase strokes.</ThemedText>}</>;
}
