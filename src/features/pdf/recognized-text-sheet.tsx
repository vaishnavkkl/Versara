import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { AppBottomSheet } from '@/components/app-bottom-sheet';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { EditorOption } from '@/components/editor-option';
import { OptionCard } from '@/components/option-sheet';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { usePalette } from '@/theme/colors';

type TextPage = { title: string; paragraphs: string[]; lines: string[] };

const BULLET = /^([•·▪◦‣*-]|\d{1,3}[.)]|[a-z][.)])\s/i;

/** Joins wrapped lines into paragraphs. Blank lines, list items and short sentence-ending lines start new paragraphs. */
function reflow(block: string) {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  const widest = Math.max(0, ...lines.map(line => line.length));
  const paragraphs: string[] = [];
  let current = '';
  lines.forEach((line, index) => {
    if (!current) current = line;
    else if (BULLET.test(line)) { paragraphs.push(current); current = line; }
    else if (/[A-Za-z]-$/.test(current) && /^[a-z]/.test(line)) current = current.slice(0, -1) + line;
    else current += ' ' + line;
    const next = lines[index + 1];
    const endsSentence = /[.!?:;]["')\]]?$/.test(line) && line.length < widest * 0.7;
    if (!next || endsSentence || BULLET.test(next)) { paragraphs.push(current); current = ''; }
  });
  if (current) paragraphs.push(current);
  return paragraphs;
}

/** Splits exported text on its "--- Page N ---" markers. */
export function parseRecognizedText(raw: string): TextPage[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const parts = text.split(/^--- Page (\d+) ---$/m);
  const pages: TextPage[] = [];
  if (parts[0].trim()) pages.push({ title: 'Text', lines: parts[0].trim().split('\n'), paragraphs: parts[0].split(/\n\s*\n+/).flatMap(reflow) });
  for (let index = 1; index < parts.length; index += 2) {
    const body = (parts[index + 1] ?? '').trim();
    pages.push({ title: `Page ${parts[index]}`, lines: body ? body.split('\n') : [], paragraphs: body.split(/\n\s*\n+/).flatMap(reflow) });
  }
  return pages;
}

async function copy(text: string, what: string) {
  try {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    toast(`${what} copied`);
  } catch {
    showDialog('Could not copy', 'Install the latest app build to copy text.', undefined, { ios: 'doc.on.doc', android: 'content-copy' });
  }
}

function TextSheet({ title, isPresented, onClose, children }: { title: string; isPresented: boolean; onClose: () => void; children: ReactNode }) {
  return <AppBottomSheet visible={isPresented} onClose={onClose} title={title} icon={{ ios: 'text.viewfinder', android: 'document-scanner' }} maxHeight={0.92}>{children}</AppBottomSheet>;
}

/** Full recognized text, one page at a time, as selectable paragraphs with copy actions. */
export function RecognizedTextSheet({ text, isPresented, onClose, truncated = false }: { text: string; isPresented: boolean; onClose: () => void; truncated?: boolean }) {
  const colors = usePalette();
  const pages = useMemo(() => parseRecognizedText(text), [text]);
  const [index, setIndex] = useState(0);
  const [keepLines, setKeepLines] = useState(false);
  const page = pages[Math.min(index, pages.length - 1)];
  const format = (item: TextPage) => (keepLines ? item.lines.join('\n') : item.paragraphs.join('\n\n')).trim();
  const all = pages.map(item => pages.length > 1 ? `${item.title}\n\n${format(item)}` : format(item)).join('\n\n\n');
  const empty = !page || !page.paragraphs.length;
  return <TextSheet title="Recognized text" isPresented={isPresented} onClose={onClose}>
    <OptionCard title="Copy" icon={{ ios: 'doc.on.doc', android: 'content-copy' }}>
      <View style={styles.row}>
        <EditorOption label="Copy all text" icon={{ ios: 'doc.on.doc', android: 'content-copy' }} disabled={!all.trim()} onPress={() => void copy(all, 'All text')} />
        {pages.length > 1 && <EditorOption label={`Copy ${page?.title.toLowerCase() ?? 'page'}`} icon={{ ios: 'doc.text', android: 'description' }} disabled={empty} onPress={() => page && void copy(format(page), page.title)} />}
      </View>
      <View style={styles.row}>
        <EditorOption label="Paragraphs" icon={{ ios: 'text.alignleft', android: 'notes' }} selected={!keepLines} onPress={() => setKeepLines(false)} />
        <EditorOption label="Original lines" icon={{ ios: 'list.bullet', android: 'format-list-bulleted' }} selected={keepLines} onPress={() => setKeepLines(true)} />
      </View>
      <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>Long-press any text to select part of it. Review recognized text for errors before relying on it.</ThemedText>
    </OptionCard>
    {pages.length > 1 && <View style={styles.pager}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous page of text" disabled={index === 0} onPress={() => setIndex(value => Math.max(0, value - 1))} style={[styles.icon, index === 0 && styles.dim]}>
        <UniversalIcon ios="chevron.left" android="chevron-left" size={24} color={colors.systemBlue} />
      </Pressable>
      <ThemedText style={styles.pageLabel}>{page?.title} · {index + 1} of {pages.length}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="Next page of text" disabled={index >= pages.length - 1} onPress={() => setIndex(value => Math.min(pages.length - 1, value + 1))} style={[styles.icon, index >= pages.length - 1 && styles.dim]}>
        <UniversalIcon ios="chevron.right" android="chevron-right" size={24} color={colors.systemBlue} />
      </Pressable>
    </View>}
    <OptionCard title={page?.title ?? 'Text'} icon={{ ios: 'text.alignleft', android: 'notes' }}>
      {empty ? <ThemedText style={{ color: colors.secondaryLabel }}>No text was recognized on this page.</ThemedText>
        : keepLines ? <ThemedText selectable style={styles.body}>{format(page)}</ThemedText>
        : page.paragraphs.map((paragraph, item) => <View key={item} style={styles.paragraph}>
          <ThemedText selectable style={[styles.body, styles.grow]}>{paragraph}</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel={`Copy paragraph ${item + 1}`} hitSlop={4} onPress={() => void copy(paragraph, 'Paragraph')} style={styles.copy}>
            <UniversalIcon ios="doc.on.doc" android="content-copy" size={16} color={colors.secondaryLabel} />
          </Pressable>
        </View>)}
    </OptionCard>
    {truncated && <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>This text is very long, so only the beginning is shown. Save or share the text file for the full result.</ThemedText>}
  </TextSheet>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontSize: 12, lineHeight: 16 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pageLabel: { fontSize: 14, fontWeight: '600' },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.35 },
  paragraph: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  body: { fontSize: 15, lineHeight: 23 },
  grow: { flex: 1, minWidth: 0 },
  copy: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
