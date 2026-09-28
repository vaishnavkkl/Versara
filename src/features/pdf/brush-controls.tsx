import { View } from 'react-native';
import { EditorOption } from '@/components/editor-option';
export const BRUSHES = [
  { id: 'pen', label: 'Pen', width: .005 }, { id: 'pencil', label: 'Pencil', width: .002 },
  { id: 'marker', label: 'Marker', width: .018 }, { id: 'highlighter', label: 'Highlighter', width: .025 },
] as const;
export function BrushControls({ brush, pattern, onBrush, onPattern, disabled }: {
  brush: string; pattern: string; onBrush: (value: string, width: number) => void; onPattern: (value: string) => void; disabled?: boolean;
}) {
  return <><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{BRUSHES.map(item => <EditorOption key={item.id} label={item.label} selected={brush === item.id} disabled={disabled} onPress={() => onBrush(item.id, item.width)} />)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['solid', 'dashed', 'dotted'].map(value => <EditorOption key={value} label={`${value[0].toUpperCase()}${value.slice(1)}`} selected={pattern === value} disabled={disabled} onPress={() => onPattern(value)} />)}</View></>;
}
