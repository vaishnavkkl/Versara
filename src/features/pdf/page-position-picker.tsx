import { Pressable, View } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
export function PagePositionPicker({ value, onChange, disabled, center = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; center?: boolean }) {
  const colors = usePalette();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(center ? ['top', 'middle', 'bottom'] : ['top', 'bottom']).flatMap(row => ['left', 'center', 'right'].map(column => {
    const id = `${row}-${column}`, selected = value === id, ink = selected ? colors.systemBlue : colors.secondaryLabel;
    const x = column === 'left' ? 6 : column === 'right' ? 18 : 12, y = row === 'top' ? 8 : row === 'middle' ? 19 : 30;
    return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${row} ${column}`} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(id)} style={{ width: 84, minHeight: 66, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: selected ? colors.accentSurface : colors.fieldSurface, opacity: disabled ? .4 : 1 }}>
      <Svg width={28} height={38} viewBox="0 0 28 38"><Rect x={2} y={2} width={24} height={34} rx={3} stroke={ink} fill="none" strokeWidth={1.5} /><Line x1={x-3} x2={x+3} y1={y} y2={y} stroke={ink} strokeWidth={3} strokeLinecap="round" /></Svg>
      <ThemedText style={{ fontSize: 10, color: ink }}>{row} {column}</ThemedText>
    </Pressable>;
  }))}</View>;
}
