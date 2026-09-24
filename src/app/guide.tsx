import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { TOOL_HELP } from '@/constants/tool-help';

export default function GuideScreen() {
  const colors = usePalette();
  const { tool } = useLocalSearchParams<{ tool?: string }>();
  const instructions = tool ? TOOL_HELP[tool] : undefined;
  const [step, setStep] = useState(0);
  const [changed, setChanged] = useState(false);
  const [practising, setPractising] = useState(false);
  function close() { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: colors.systemBackground }]}>
    <View style={styles.header}><ThemedText accessibilityRole="header" style={styles.title}>{instructions ? 'How to use this tool' : 'A quick start'}</ThemedText><Pressable accessibilityRole="button" accessibilityLabel="Close guide" onPress={close} style={styles.close}><UniversalIcon ios="xmark" android="close" size={24} color={colors.systemBlue} /></Pressable></View>
    <ScrollView contentContainerStyle={styles.content}>
      {!practising ? <>
        <ThemedText style={{ color: colors.secondaryLabel }}>Just a few steps. Go at your own pace.</ThemedText>
        {(instructions ?? ['Choose PDF, Image, Video or Audio. Open a file or pick one from Recents.', 'Preview your file. In a PDF, tap the small pages below to jump ahead. Open Options to choose a tool.', 'Make your changes and save the result as a new copy.']).map((text, index) => <View key={text} style={styles.row}><View style={[styles.number, { backgroundColor: colors.accentSurface }]}><ThemedText style={{ color: colors.systemBlue, fontWeight: '600' }}>{index + 1}</ThemedText></View><ThemedText style={styles.grow}>{text}</ThemedText></View>)}
        <View style={[styles.note, { backgroundColor: colors.secondarySystemBackground }]}><UniversalIcon ios="lock.shield" android="security" size={22} color={colors.systemBlue} /><ThemedText style={styles.grow}>File processing happens on your device. Your original stays unchanged.</ThemedText></View>
        <ToolButton title="Try a short practice demo" onPress={() => setPractising(true)} />
        <ToolButton title="Got it" secondary onPress={close} />
      </> : <>
        <ThemedText accessibilityLiveRegion="polite" style={{ color: colors.secondaryLabel }}>Practice only · {step + 1} of 3 · No real files used</ThemedText>
        <ThemedText accessibilityRole="header" style={styles.title}>{['1. Choose a file', '2. Make a change', '3. Check and save'][step]}</ThemedText>
        <View style={[styles.sample, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
          <UniversalIcon ios="doc.text" android="description" size={32} color={colors.systemBlue} />
          <ThemedText style={styles.sampleTitle}>{step === 2 ? 'Weekend plan - edited.pdf' : 'Weekend plan.pdf'}</ThemedText>
          <View style={[styles.paper, { borderColor: colors.separator }]}><ThemedText style={styles.paperTitle}>Weekend plan</ThemedText><ThemedText style={styles.paperText}>Meet friends</ThemedText><ThemedText style={[styles.paperText, { fontWeight: '600' }]}>{changed ? '10:00 AM' : '9:00 AM'}</ThemedText><View style={styles.line} /><View style={[styles.line, { width: '65%' }]} /></View>
        </View>
        <ThemedText>{['Normally, your device opens Files. For this demo, select the example above.', 'Try changing the meeting time. In Edit PDF, tap real text, type your change and tap Apply.', 'Check your result, then use Save to device / share in a real tool. This demo has not created or saved a file.'][step]}</ThemedText>
        {step === 0 ? <ToolButton title="Use this example" onPress={() => setStep(1)} /> : step === 1 ? <><ToolButton title={changed ? 'Undo example change' : 'Change time to 10:00 AM'} onPress={() => setChanged(value => !value)} /><ToolButton title="See the result" secondary disabled={!changed} onPress={() => setStep(2)} /></> : <ToolButton title="Finish demo" onPress={close} />}
        <ToolButton title={step > 0 ? 'Back' : 'Skip demo'} secondary onPress={() => step > 0 ? setStep(value => value - 1) : close()} />
      </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 }, title: { fontSize: 20, fontWeight: '600', flex: 1 },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, gap: 20, width: '100%', maxWidth: 600, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60 }, grow: { flex: 1 }, number: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  note: { padding: 16, borderRadius: 16, gap: 12, flexDirection: 'row', alignItems: 'center' }, sample: { padding: 20, borderRadius: 20, borderWidth: 1, alignItems: 'center', gap: 12 }, sampleTitle: { fontSize: 14, fontWeight: '600' },
  paper: { padding: 20, gap: 12, width: '100%', maxWidth: 240, borderWidth: 1, backgroundColor: '#FFFFFF', borderRadius: 8 }, paperTitle: { color: '#101643', fontSize: 18, fontWeight: '600' }, paperText: { color: '#101643' }, line: { height: 5, backgroundColor: '#DADFF4', borderRadius: 3 },
});
