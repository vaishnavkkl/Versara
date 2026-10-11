import { editorActions as metrics } from '@/theme/dashboard';
import { Children, createContext, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewProps } from 'react-native';

export const EditorActionContext = createContext(false);

function actions(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child => isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? actions(child.props.children) : [child]);
}

/** Equal action cells. Long labels and accessibility text grow the entire row together. */
export function EditorActionBar({ children, onLayout, vertical = false }: { children: ReactNode; onLayout?: ViewProps['onLayout']; vertical?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const items = actions(children);
  const capacity = Math.max(1, Math.floor(((width || 320) + metrics.gap) / (metrics.minWidth * Math.max(1, fontScale) + metrics.gap)));
  // Four actions form two balanced rows instead of leaving Save alone in a three-column row.
  const columns = vertical || !items.length ? 1 : Math.ceil(items.length / Math.ceil(items.length / capacity));
  const sizeKey = `${width}:${fontScale}:${columns}:${items.length}`;
  const [measured, setMeasured] = useState<{ key: string; height: number }>({ key: '', height: metrics.minHeight });
  const height = measured.key === sizeKey ? measured.height : metrics.minHeight;
  return <EditorActionContext.Provider value><View style={styles.bar} onLayout={event => { setWidth(event.nativeEvent.layout.width); onLayout?.(event); }}>
    {items.filter((_, index) => index % columns === 0).map((_, row) => <View key={row} style={styles.row}>
      {items.slice(row * columns, (row + 1) * columns).map((item, index) => <View key={isValidElement(item) ? item.key ?? index : index} style={[styles.cell, { minHeight: height }]} onLayout={event => {
        const nextHeight = Math.round(event.nativeEvent.layout.height);
        setMeasured(previous => previous.key === sizeKey && previous.height >= nextHeight ? previous : { key: sizeKey, height: Math.max(metrics.minHeight, previous.key === sizeKey ? previous.height : metrics.minHeight, nextHeight) });
      }}>{item}</View>)}
      {Array.from({ length: Math.max(0, columns - items.slice(row * columns, (row + 1) * columns).length) }, (_, index) => <View key={`space-${index}`} style={styles.cell} />)}
    </View>)}
  </View></EditorActionContext.Provider>;
}

export const editorActionStyles = StyleSheet.create({
  button: { flexGrow: 1, width: '100%', minWidth: 0, minHeight: metrics.minHeight, maxWidth: '100%', flexDirection: 'column', gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: metrics.fontSize, lineHeight: metrics.lineHeight, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  anchor: { flexGrow: 1, alignSelf: 'stretch', width: '100%' },
});
const styles = StyleSheet.create({ bar: { width: '100%', gap: metrics.gap }, row: { flexDirection: 'row', alignItems: 'stretch', gap: metrics.gap }, cell: { flex: 1, minWidth: 0 } });
