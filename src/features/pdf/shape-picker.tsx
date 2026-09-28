import { Pressable, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { usePalette } from '@/theme/colors';

const regular = (count: number, inner = 1): [number, number][] => Array.from({ length: count }, (_, i) => {
  const angle = i * Math.PI * 2 / count - Math.PI / 2, r = i % 2 ? inner : 1;
  return [0.5 + Math.cos(angle) * r * 0.5, 0.5 + Math.sin(angle) * r * 0.5];
});
export const SHAPES: { id: string; label: string; points: [number, number][]; open?: boolean }[] = [
  { id: 'rectangle', label: 'Rectangle', points: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { id: 'ellipse', label: 'Ellipse', points: regular(64) },
  { id: 'triangle', label: 'Triangle', points: [[0.5, 0], [1, 1], [0, 1]] },
  { id: 'diamond', label: 'Diamond', points: regular(4) },
  { id: 'pentagon', label: 'Pentagon', points: regular(5) },
  { id: 'hexagon', label: 'Hexagon', points: regular(6) },
  { id: 'star', label: 'Star', points: regular(10, 0.42) },
  { id: 'arrow', label: 'Arrow', points: [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]] },
  { id: 'line', label: 'Line', points: [[0, 0], [1, 1]], open: true },
  { id: 'chevron', label: 'Chevron', points: [[0, 0], [0.4, 0], [1, 0.5], [0.4, 1], [0, 1], [0.6, 0.5]] },
  { id: 'octagon', label: 'Octagon', points: regular(8) },
  { id: 'burst', label: 'Seal', points: regular(24, .78) },
  { id: 'cross', label: 'Cross', points: [[.3,0],[.7,0],[.7,.3],[1,.3],[1,.7],[.7,.7],[.7,1],[.3,1],[.3,.7],[0,.7],[0,.3],[.3,.3]] },
  { id: 'parallelogram', label: 'Parallelogram', points: [[.25,0],[1,0],[.75,1],[0,1]] },
  { id: 'trapezoid', label: 'Trapezoid', points: [[.25,0],[.75,0],[1,1],[0,1]] },
  { id: 'speech', label: 'Speech bubble', points: [[0,0],[1,0],[1,.75],[.45,.75],[.2,1],[.2,.75],[0,.75]] },
  { id: 'double-arrow', label: 'Double arrow', points: [[0,.5],[.3,0],[.3,.3],[.7,.3],[.7,0],[1,.5],[.7,1],[.7,.7],[.3,.7],[.3,1]] },
  { id: 'heart', label: 'Heart', points: [[.5,1],[.05,.5],[0,.25],[.1,.05],[.3,0],[.5,.2],[.7,0],[.9,.05],[1,.25],[.95,.5]] },
];
export function ShapePicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const colors = usePalette();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{SHAPES.map(shape => {
    const Element = shape.open ? Polyline : Polygon;
    return <Pressable key={shape.id} accessibilityRole="button" accessibilityLabel={shape.label} accessibilityState={{ selected: shape.id === value, disabled }} disabled={disabled} onPress={() => onChange(shape.id)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: value === shape.id ? colors.systemBlue : colors.accentSurface }}>
      <Svg width={28} height={28} viewBox="-0.1 -0.1 1.2 1.2"><Element points={shape.points.map(point => point.join(',')).join(' ')} fill="none" stroke={value === shape.id ? colors.systemBackground : colors.systemBlue} strokeWidth={0.07} strokeLinejoin="round" /></Svg>
    </Pressable>;
  })}</View>;
}
