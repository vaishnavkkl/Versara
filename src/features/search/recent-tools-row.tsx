import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { showDialog } from '@/components/app-dialog';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { toolColors } from '@/theme/tool-colors';
import { catalog, spacing as s, typography as t } from '@/theme/dashboard';
import { hydrateSearchHistory, useSearchHistory } from './search-history';
import { openSearchTool } from './open-search-tool';
import { SEARCH_TOOLS, type SearchTool } from './search-tools';

const LIMIT = 3;

/** The last tools the user opened, one tap away. Hidden until a tool has been used. */
export function RecentToolsRow() {
  const colors = usePalette();
  const history = useSearchHistory();
  const [opening, setOpening] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; hydrateSearchHistory(); return () => { mounted.current = false; }; }, []);
  const tools = history.tools.map(key => SEARCH_TOOLS.find(tool => tool.key === key))
    .filter((tool): tool is SearchTool => !!tool && tool.availability === 'ready').slice(0, LIMIT);
  if (!tools.length) return null;
  const open = async (tool: SearchTool) => {
    if (opening) return;
    setOpening(tool.key);
    try { await openSearchTool(tool, () => mounted.current); }
    catch (cause) { if (mounted.current) showDialog('Could not open tool', (cause as Error).message || 'Please try again.'); }
    finally { if (mounted.current) setOpening(null); }
  };
  return <View style={styles.section}>
    <ThemedText accessibilityRole="header" style={styles.title}>Recently used</ThemedText>
    <View style={styles.row}>
      {tools.map(tool => {
        const tint = toolColors(tool.id, colors);
        return <Pressable key={tool.key} accessibilityRole="button" accessibilityLabel={`${tool.title}, ${tool.module}`} accessibilityState={{ busy: opening === tool.key, disabled: !!opening }}
          disabled={!!opening} onPress={() => void open(tool)}
          style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? colors.catalogPressed : colors.catalogSurface, borderColor: colors.catalogBorder, opacity: opening && opening !== tool.key ? 0.5 : 1 }]}>
          <View style={[styles.icon, tint.fill]}>
            {opening === tool.key ? <AppLoader color={tint.glyph} /> : <UniversalIcon ios={tool.ios} android={tool.android} size={24} color={tint.glyph} />}
          </View>
          <ThemedText numberOfLines={2} style={[styles.label, { color: colors.label }]}>{tool.title}</ThemedText>
        </Pressable>;
      })}
      {Array.from({ length: LIMIT - tools.length }, (_, index) => <View key={`space:${index}`} style={styles.spacer} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: s.md },
  title: { ...t.catalogTitle },
  row: { flexDirection: 'row', gap: s.sm },
  tile: { flex: 1, minWidth: 0, alignItems: 'center', gap: s.sm, paddingVertical: s.md, paddingHorizontal: s.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: catalog.cardRadius, borderCurve: 'continuous' },
  spacer: { flex: 1 },
  icon: { width: 46, height: 46, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  label: { ...t.caption, fontWeight: '600', textAlign: 'center' },
});
