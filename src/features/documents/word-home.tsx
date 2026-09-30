import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ModuleCard } from '@/components/module-card';
import { ThemedText } from '@/components/themed-text';
import { isDocEditorAvailable } from '../../../modules/doc-engine';
import { RecentFilesScreen } from '@/features/files/recent-files-screen';
import { recordToolUse } from '@/features/search/search-history';
import { spacing as s } from '@/theme/dashboard';
import { DOCUMENT_SECTIONS } from './document-tools';
import { openRecentDocument, startNewDocument } from './open-document';

/** Two ways to start writing, then every recent Word and text file like the PDF list. */
export function WordHome() {
  const [error, setError] = useState('');
  const tools = DOCUMENT_SECTIONS[0].tools;
  function start(id: string) {
    if (!isDocEditorAvailable) { setError('Install a new development build to edit documents.'); return; }
    setError('');
    startNewDocument(id === 'text' ? 'txt' : 'docx');
    recordToolUse(`Documents:${id}`);
  }
  const header = <View style={styles.header}>
    <View style={styles.row}>
      {tools.map(tool => <View key={tool.id} style={styles.cell}>
        <ModuleCard title={tool.title} description={tool.subtitle} ios={tool.ios} android={tool.android} tone="word" variant="dashboard" onPress={() => start(tool.id)} />
      </View>)}
    </View>
    {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
  </View>;
  return <RecentFilesScreen kind="document" selectionTitle="Documents" header={header}
    back={{ label: 'Toolbox', onPress: () => router.navigate('/(tabs)') }}
    onSelect={async file => {
      if (!isDocEditorAvailable) { setError('Install a new development build to edit documents.'); return false; }
      return openRecentDocument(file);
    }} />;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: s.lg, paddingBottom: s.sm, gap: s.sm },
  row: { flexDirection: 'row', gap: s.md },
  cell: { flex: 1 },
});
