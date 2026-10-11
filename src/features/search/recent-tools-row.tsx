import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { showDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
import { catalog, spacing as s, typography as t } from '@/theme/dashboard';
import { hydrateSearchHistory, useSearchHistory } from './search-history';
import { openSearchTool } from './open-search-tool';
import { SEARCH_TOOLS, type SearchTool } from './search-tools';
import { AppGlyph } from '@/components/app-glyph';

const LIMIT = 3;

/** The last tools the user opened, one tap away. Hidden until a tool has been used. */
export function RecentToolsRow() {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  const colors = usePalette();
  const history = useSearchHistory();
  const [opening, setOpening] = useState<string | null>(null);
  const mounted = useRef(true);
  const openingRef = useRef(false);
  useEffect(() => { mounted.current = true; hydrateSearchHistory(); return () => { mounted.current = false; }; }, []);
  const tools = history.tools.map(key => SEARCH_TOOLS.find(tool => tool.key === key))
    .filter((tool): tool is SearchTool => !!tool && tool.availability === 'ready').slice(0, LIMIT);
  if (!tools.length) return null;
  const open = async (tool: SearchTool) => {
    if (openingRef.current || tool.availability !== 'ready') return;
    openingRef.current = true;
    setOpening(tool.key);
    try { await openSearchTool(tool, () => mounted.current); }
    catch (cause) { if (mounted.current) showDialog('Could not open tool', (cause as Error).message || 'Please try again.'); }
    finally { openingRef.current = false; if (mounted.current) setOpening(null); }
  };
  return <View style={styles.section}>
    <ThemedText accessibilityRole="header" style={styles.title}>Recently used</ThemedText>
    <View style={[styles.row, stacked && styles.wrap]}>
      {tools.map(tool => {
        return <Pressable key={tool.key} accessibilityRole="button" accessibilityLabel={`${tool.title}, ${tool.module}${tool.availability !== 'ready' ? ', Requires app update' : ''}`} accessibilityState={{ busy: opening === tool.key, disabled: !!opening || tool.availability !== 'ready' }}
          disabled={!!opening || tool.availability !== 'ready'} onPress={() => void open(tool)}
          style={({ pressed }) => [styles.tile, stacked && { flexBasis: stacked ? '100%' : '47%' }, { backgroundColor: pressed ? colors.catalogPressed : colors.catalogSurface, borderColor: colors.catalogBorder, opacity: opening && opening !== tool.key ? 0.5 : 1 }]}>
          <AppGlyph id={tool.id} ios={tool.ios} android={tool.android} size={46} loading={opening === tool.key} />
          <View >
            <ThemedText style={[styles.label, { color: colors.label }]}>{tool.title}</ThemedText>
            {tool.availability !== 'ready' && <ThemedText style={[styles.hint, { color: colors.secondaryLabel }]}>Requires app update</ThemedText>}
          </View>
        </Pressable>;
      })}

    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: s.md },
  title: { ...t.catalogTitle },
  row: { flexDirection: 'row', gap: s.sm },
  tile: { flex: 1, minWidth: 0, alignItems: 'center', gap: s.sm, paddingVertical: s.md, paddingHorizontal: s.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: catalog.cardRadius, borderCurve: 'continuous' },
  wrap: { flexWrap: 'wrap' },
  hint: { ...t.caption },
  icon: { width: 46, height: 46, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  label: { ...t.caption, fontWeight: '600', textAlign: 'center' },
});
