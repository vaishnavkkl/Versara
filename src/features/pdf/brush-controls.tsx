import { View } from 'react-native';
import { Host, Slider } from '@expo/ui';
import { useControlHelp } from '@/components/control-help';
import { HelpPressable } from '@/components/help-pressable';
import { ThemedText } from '@/components/themed-text';
import { EditorActionBar } from '@/components/editor-action-bar';
import { EditorOption } from '@/components/editor-option';
import { useAppearance, usePalette } from '@/theme/colors';

export const BRUSHES = [
  { id: 'pen', label: 'Pen', colorKey: 'pen', width: .005, opacity: 1, icon: { ios: 'pencil.tip' as const, android: 'draw' as const } },
  { id: 'pencil', label: 'Pencil', colorKey: 'pencil', width: .0035, opacity: 200 / 255, icon: { ios: 'pencil' as const, android: 'edit' as const } },
  { id: 'marker', label: 'Marker', colorKey: 'marker', width: .018, opacity: 210 / 255, icon: { ios: 'paintbrush.pointed' as const, android: 'brush' as const } },
  { id: 'highlighter', label: 'Highlighter', colorKey: 'highlighter', width: .025, opacity: .3, icon: { ios: 'highlighter' as const, android: 'border-color' as const } },
] as const;

export function BrushControls({ brush, pattern, onBrush, onPattern, disabled, patternsAvailable, opacity, onOpacity, erasing, onEraser, editingAvailable = false, showSelectors = true }: {
  brush: string; pattern: string; onBrush: (value: string, width: number, opacity: number) => void; onPattern: (value: string) => void; disabled?: boolean; patternsAvailable: boolean;
  opacity?: number; onOpacity?: (value: number) => void; erasing?: boolean; onEraser?: () => void; editingAvailable?: boolean;
  showSelectors?: boolean;
}) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const help = useControlHelp();
  const selectedBrush = BRUSHES.find(item => item.id === brush);
  const strength = opacity ?? selectedBrush?.opacity ?? 1;
  return <>
    {showSelectors && <>
      <EditorActionBar>
        {BRUSHES.map(item => <EditorOption key={item.id} compact label={item.label} colorId={item.colorKey} icon={item.icon}
          selected={!erasing && brush === item.id} disabled={disabled}
          onPress={() => onBrush(item.id, item.width, item.opacity)} />)}
        {onEraser && <EditorOption compact label="Eraser" colorId="redact" icon={{ ios: 'eraser', android: 'auto-fix-normal' }}
          selected={!!erasing} disabled={disabled || !editingAvailable} onPress={onEraser} />}
      </EditorActionBar>
      <EditorActionBar>
        {(['solid', 'dashed', 'dotted'] as const).map(value => <EditorOption key={value} compact
          label={`${value[0].toUpperCase()}${value.slice(1)}`}
          colorId={value === 'solid' ? 'rotate' : value === 'dashed' ? 'compress' : 'export'}
          icon={{ ios: 'line.diagonal', android: 'line-style' }}
          selected={pattern === value} disabled={disabled || (value !== 'solid' && !patternsAvailable)}
          onPress={() => onPattern(value)} />)}
      </EditorActionBar>
      {!patternsAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to use dotted and dashed strokes.</ThemedText>}
    </>}
    {onOpacity && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ThemedText>Opacity</ThemedText><HelpPressable pointerEvents={help?.active ? 'auto' : 'box-none'} accessibilityRole="button" accessibilityLabel="Stroke opacity" helpText="Stroke opacity: adjust how transparent the selected stroke appears." disabled={disabled || erasing || !editingAvailable} style={{ flex: 1 }}><View pointerEvents={help?.active ? 'none' : 'auto'}><Host colorScheme={mode} seedColor={colors.accent} matchContents={{ vertical: true }}><Slider value={strength} min={.01} max={1} step={.01} disabled={help?.active || disabled || erasing || !editingAvailable} onValueChange={onOpacity} /></Host></View></HelpPressable><ThemedText style={{ minWidth: 40, fontVariant: ['tabular-nums'] }}>{Math.round(strength * 100)}%</ThemedText></View>}
    {onEraser && erasing && <ThemedText style={{ fontSize: 12 }}>Touch an ink stroke to remove the whole stroke. Undo restores it.</ThemedText>}
    {(onOpacity || onEraser) && !editingAvailable && <ThemedText style={{ fontSize: 12 }}>Update the app build to change opacity or erase strokes.</ThemedText>}
  </>;
}
