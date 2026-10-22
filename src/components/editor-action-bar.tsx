import { brandFont, editorActions as metrics } from '@/theme/dashboard';
import { Children, cloneElement, createContext, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewProps } from 'react-native';

export const EditorActionContext = createContext(false);

/** Flattens fragments; nested keys carry their fragment's key, since `Children.toArray` restarts at `.0` inside each one. */
function actions(children: ReactNode, prefix = ''): ReactNode[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [child];
    if (child.type === Fragment) return actions(child.props.children, `${prefix}${child.key}/`);
    return [prefix ? cloneElement(child, { key: `${prefix}${child.key}` }) : child];
  });
}

/** Equal action cells. One row for up to six tools; more than six split into two balanced rows. */
export function EditorActionBar({ children, onLayout, vertical = false }: { children: ReactNode; onLayout?: ViewProps['onLayout']; vertical?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const items = actions(children);
  const columns = vertical || !items.length ? 1
    : items.length <= metrics.singleRowMax ? items.length
    : Math.ceil(items.length / 2);
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
  /** Secondary dock control: glyph tile + caption. */
  option: {
    flexGrow: 1, width: '100%', minWidth: 0, minHeight: metrics.minHeight, maxWidth: '100%',
    flexDirection: 'column', gap: 6, paddingHorizontal: 0, paddingVertical: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  optionLabel: {
    ...brandFont.label,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    letterSpacing: -0.2,
    textAlign: 'center',
    flexShrink: 1,
  },
  /** Kept for callers that style a primary control to match dock geometry. */
  button: {
    flexGrow: 1, width: '100%', minWidth: 0, minHeight: metrics.minHeight, maxWidth: '100%',
    flexDirection: 'column', gap: 6, paddingHorizontal: 0, paddingVertical: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  label: {
    ...brandFont.label,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    letterSpacing: -0.2,
    textAlign: 'center',
    flexShrink: 1,
  },
  anchor: { flexGrow: 1, alignSelf: 'stretch', width: '100%' },
});
const styles = StyleSheet.create({
  bar: { width: '100%', gap: metrics.gap },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: metrics.gap },
  cell: { flex: 1, minWidth: 0 },
});
