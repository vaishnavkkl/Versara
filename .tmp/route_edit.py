p='src/app/pdf-tool.tsx'; s=open(p,encoding='utf8').read()
rep=[
("""import { disposeImports } from '@/features/files/file-storage';
import { forgetPdfToolSession, getPdfToolSession } from '@/features/pdf/pdf-tool-session';""",
"""import { File } from 'expo-file-system';
import { createImportDirectory, disposeImports, savedPdfDirectory } from '@/features/files/file-storage';
import { savePdfResult } from '@/features/files/save-file';
import { createPdfToolForWorkingCopy, editingPdfTools, forgetPdfToolSession, getPdfToolSession, implementedPdfTools, retainPdfEditingSource, type PdfTool } from '@/features/pdf/pdf-tool-session';
import { copyPdf, currentPdfHandoff, usePdfHandoffState } from '@/features/pdf/pdf-handoff';
import { PDF_SECTIONS } from '@/constants/pdf-methods';
import { ToolboxSheet } from '@/components/toolbox-sheet';"""),
("import { HeaderGlyph } from '@/components/app-glyph';", "import { BrandGlyph, HeaderGlyph } from '@/components/app-glyph';"),
("""export default function PdfToolScreen() {
  return <ControlHelpProvider><PdfToolContent /></ControlHelpProvider>;
}""",
"""const pdfMethods = PDF_SECTIONS.flatMap(section => [...section.tools]);

export default function PdfToolScreen() {
  const { session } = useLocalSearchParams<{ session: string }>();
  // Switching tools replaces this route with a new session, so each session gets a fresh tool.
  return <ControlHelpProvider><PdfToolContent key={session} /></ControlHelpProvider>;
}"""),
("""  const share = useHeaderShare();
  const help = useControlHelp();""",
"""  const share = useHeaderShare();
  const help = useControlHelp();
  const handoff = usePdfHandoffState();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  // A carried working copy saved from this screen becomes the original for later tools.
  const [workingSaved, setWorkingSaved] = useState<{ uri: string; name: string } | null>(null);
  const carriedUnsaved = !!session?.carried && !workingSaved && !handoff?.saved;
  const leaveUnsaved = unsaved || carriedUnsaved;
  const toolSections = useMemo(() => PDF_SECTIONS.map(section => ({ title: section.title, data: section.tools.filter(item => implementedPdfTools.has(item.id) && item.id !== 'from_image' && item.id !== session?.tool) }))
    .filter(section => section.data.length), [session?.tool]);"""),
("""    if (!unsaved) { leave(); return; }""", """    if (!leaveUnsaved) { leave(); return; }"""),
("""  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!unsaved) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => subscription.remove();
  }, [unsaved]);
  const tool = session?.tool;""",
"""  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!leaveUnsaved && !switching) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!switching) closeRef.current(); return true; });
    return () => subscription.remove();
  }, [leaveUnsaved, switching]);
  function chooseTool(next: string) {
    if (!session || switching) return;
    const current = currentPdfHandoff();
    if (current?.blocked) { showDialog('Continue with one PDF', current.blocked, undefined, { ios: 'square.grid.2x2', android: 'apps' }); return; }
    if (!current) { showDialog('Create the PDF first', 'Finish this tool, then continue with another tool.', undefined, { ios: 'square.grid.2x2', android: 'apps' }); return; }
    if (current.pending) {
      showDialog('Continue without these changes?', current.pending, [
        { text: 'Stay', style: 'cancel' },
        { text: 'Continue', onPress: () => void switchTool(next) },
      ], { ios: 'square.grid.2x2', android: 'apps' });
      return;
    }
    void switchTool(next);
  }
  async function switchTool(next: string) {
    const method = pdfMethods.find(item => item.id === next);
    const current = currentPdfHandoff();
    if (!session || !method || !current || switching) return;
    Keyboard.dismiss();
    setSwitching(true);
    const directory = createImportDirectory();
    try {
      directory.create({ intermediates: true, idempotent: true });
      const file = new File(directory, 'source.pdf');
      await current.write(file.uri);
      if (!file.exists || !file.size) throw new Error('The PDF could not be prepared for the next tool.');
      const changed = current.changed;
      const saved = current.saved ?? workingSaved;
      const carried = saved ? changed : (!!session.carried || changed);
      let origin = saved ?? session.origin;
      if (!origin && !carried && editingPdfTools.has(next as PdfTool)) origin = await retainPdfEditingSource(session.files[0]);
      if (!mounted.current) { disposeImports(directory); return; }
      // The next tool continues these edits, so a recovered draft would only duplicate them.
      if (changed) await discardDraft.current().catch(() => undefined);
      const name = origin?.name ?? session.files[0]?.name ?? 'Document.pdf';
      const nextId = createPdfToolForWorkingCopy(next as PdfTool, method.title, directory, { uri: file.uri, name, mimeType: 'application/pdf', size: file.size }, { origin, carried, returnRoute: session.returnRoute });
      router.replace({ pathname: '/pdf-tool', params: landscape ? { session: nextId, landscape: '1' } : { session: nextId } });
    } catch (cause) {
      disposeImports(directory);
      if (mounted.current) showDialog('Could not open the tool', (cause as Error).message || 'Please try again.', undefined, { ios: 'exclamationmark.triangle', android: 'warning' });
    } finally { if (mounted.current) setSwitching(false); }
  }
  async function saveWorkingCopy() {
    if (!session) return;
    const library = savedPdfDirectory();
    library.create({ intermediates: true, idempotent: true });
    // Saving takes ownership of its output, so it gets a copy and the working file stays open here.
    const output = new File(library, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    try {
      await copyPdf(session.files[0].uri, output.uri);
      const saved = await savePdfResult({ uri: output.uri, name: session.origin?.name ?? session.files[0].name }, session.origin);
      if (!saved) { if (output.exists) output.delete(); return; }
      if (mounted.current) setWorkingSaved({ uri: saved.file.uri, name: saved.file.name });
    } catch (cause) { if (output.exists) output.delete(); throw cause; }
  }
  // Tools without their own changes still save what earlier tools carried in.
  const saveAction = carriedUnsaved && !handoff?.changed ? { label: 'Save PDF', onPress: saveWorkingCopy } : share?.save;
  const tool = session?.tool;
  const toolsButton = !!session && tool !== 'viewer' && <HelpPressable accessibilityRole="button" accessibilityLabel="All tools" accessibilityHint="Continue with this PDF in another tool" accessibilityState={{ disabled: switching, busy: switching }} disabled={switching} onPress={() => { Keyboard.dismiss(); setToolsOpen(true); }} hitSlop={4} style={({ pressed }) => [styles.orientation, { opacity: pressed ? .6 : 1 }]}><BrandGlyph art="tools" size={36} loading={switching} /></HelpPressable>;"""),
("""    <Stack.Screen options={{ gestureEnabled: !unsaved, orientation: landscape ? 'landscape' : 'portrait' }} />
    {!focused && <ScreenHeader title={session?.title ?? 'PDF'} onBack={close} share={share} save={share?.save}>""",
"""    <Stack.Screen options={{ gestureEnabled: !leaveUnsaved && !switching, orientation: landscape ? 'landscape' : 'portrait' }} />
    {!focused && <ScreenHeader title={session?.title ?? 'PDF'} onBack={close} share={share} save={saveAction} leading={toolsButton}>"""),
("""      : <AdvancedPdfTool session={session} onUnsavedChange={setUnsaved} onDiscardReady={registerDiscard} />}
  </SafeAreaView>""",
"""      : <AdvancedPdfTool session={session} onUnsavedChange={setUnsaved} onDiscardReady={registerDiscard} />}
    {toolsButton && <ToolboxSheet visible={toolsOpen} title="All tools" subtitle={session?.origin?.name ?? session?.files[0]?.name ?? 'PDF'} caption="Your changes carry into the next tool. Save when you are done." sections={toolSections} footer={<View />} onClose={() => setToolsOpen(false)} onAction={chooseTool} />}
  </SafeAreaView>"""),
]
for a,b in rep:
    assert a in s,a[:70]; s=s.replace(a,b)
open(p,'w',encoding='utf8').write(s)
print('ok')
