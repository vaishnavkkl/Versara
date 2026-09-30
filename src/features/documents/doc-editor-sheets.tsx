import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import type { BandAlign, DocFormat, HeaderFooter, PageSetup } from '../../../modules/doc-engine';
import { ColorSwatches } from '@/components/color-swatches';
import { ThemedText } from '@/components/themed-text';
import { ToolSheet } from '@/components/tool-sheet';
import { UniversalIcon } from '@/components/universal-icon';
import type { OptionIcon } from '@/theme/editor-icons';
import { useAppearance, usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

export const EMPTY_BANDS: HeaderFooter = { header: '', headerAlign: 'left', footer: '', footerAlign: 'left', pagePos: 'none', pageAlign: 'center', pageFormat: 'plain' };

export const DOC_STYLES = [
  { id: 'normal', label: 'Normal text', size: 15, weight: '400' },
  { id: 'title', label: 'Title', size: 24, weight: '400' },
  { id: 'subtitle', label: 'Subtitle', size: 16, weight: '400' },
  { id: 'h1', label: 'Heading 1', size: 20, weight: '700' },
  { id: 'h2', label: 'Heading 2', size: 17, weight: '700' },
  { id: 'h3', label: 'Heading 3', size: 15, weight: '700' },
] as const;

const ALIGN_ICONS: Record<DocFormat['align'], OptionIcon> = {
  left: { ios: 'text.alignleft', android: 'format-align-left' },
  center: { ios: 'text.aligncenter', android: 'format-align-center' },
  right: { ios: 'text.alignright', android: 'format-align-right' },
  justify: { ios: 'text.justify', android: 'format-align-justify' },
};
export const alignIcon = (align: DocFormat['align']) => ALIGN_ICONS[align];

/** Half-height native sheet that leaves the page visible above it. */
function DocSheet({ title, isPresented, onClose, children }: { title: string; isPresented: boolean; onClose: () => void; children: ReactNode }) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  if (!isPresented) return null;
  return <Host colorScheme={mode} seedColor={colors.accent}>
    <BottomSheet isPresented onDismiss={onClose} snapPoints={['half', 'full']} showDragIndicator containerColor={colors.systemBackground}>
      <RNHostView>
        <View style={[styles.sheet, { backgroundColor: colors.systemBackground }]}>
          <View style={styles.sheetHeader}>
            <ThemedText accessibilityRole="header" style={styles.sheetTitle}>{title}</ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} hitSlop={6} style={[styles.round, { backgroundColor: colors.accentSurface }]}>
              <UniversalIcon ios="xmark" android="close" size={18} color={colors.label} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </RNHostView>
    </BottomSheet>
  </Host>;
}

export function IconToggle({ icon, label, active = false, disabled = false, onPress, size = 22 }: { icon: OptionIcon; label: string; active?: boolean; disabled?: boolean; onPress: () => void; size?: number }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} hitSlop={2}
    style={({ pressed }) => [styles.toggle, { backgroundColor: active ? colors.wordSurface : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon {...icon} size={size} color={active ? colors.wordInk : colors.label} />
  </Pressable>;
}

function Segmented<T extends string>({ value, options, onChange, disabled = false }: { value: T; options: { id: T; label: string; icon?: OptionIcon }[]; onChange: (value: T) => void; disabled?: boolean }) {
  const colors = usePalette();
  return <View style={[styles.segmented, { backgroundColor: colors.fieldSurface, opacity: disabled ? 0.4 : 1 }]}>
    {options.map(option => {
      const selected = option.id === value;
      return <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onChange(option.id)}
        style={[styles.segment, selected && { backgroundColor: colors.systemBackground }]}>
        {option.icon ? <UniversalIcon {...option.icon} size={20} color={selected ? colors.wordInk : colors.secondaryLabel} /> : <ThemedText numberOfLines={1} style={[styles.segmentLabel, { color: selected ? colors.wordInk : colors.secondaryLabel }]}>{option.label}</ThemedText>}
      </Pressable>;
    })}
  </View>;
}

function Label({ children }: { children: ReactNode }) {
  const colors = usePalette();
  return <ThemedText style={[styles.label, { color: colors.secondaryLabel }]}>{children}</ThemedText>;
}

function Row({ icon, label, detail, onPress, disabled = false, trailing }: { icon: OptionIcon; label: string; detail?: string; onPress?: () => void; disabled?: boolean; trailing?: ReactNode }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled || !onPress} onPress={onPress}
    style={({ pressed }) => [styles.row, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon {...icon} size={24} color={colors.secondaryLabel} />
    <View style={styles.rowText}>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      {!!detail && <ThemedText style={[styles.rowDetail, { color: colors.secondaryLabel }]}>{detail}</ThemedText>}
    </View>
    {trailing}
  </Pressable>;
}

function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [styles.chip, { borderColor: selected ? colors.wordInk : colors.separator, backgroundColor: selected ? colors.wordSurface : 'transparent', opacity: pressed ? 0.6 : 1 }]}>
    <ThemedText style={[styles.chipLabel, selected && { color: colors.wordInk }]}>{label}</ThemedText>
  </Pressable>;
}

const colorValue = (value: number | null) => value == null ? '' : value.toString(16).padStart(6, '0');

type FormatProps = {
  isPresented: boolean;
  onClose: () => void;
  tab: 'text' | 'paragraph';
  onTab: (tab: 'text' | 'paragraph') => void;
  format: DocFormat;
  run: (name: string, value?: string) => void;
  /** Indent and spacing need native editor version 3. */
  spacing: boolean;
};

const LINE_SPACING = ['1', '1.15', '1.5', '2'] as const;
const lineChoice = (line: number) => LINE_SPACING.find(id => Math.abs(Number(id) * 240 - line) < 12) ?? ('' as (typeof LINE_SPACING)[number]);

/** Twips shown in inches or centimetres, following the device's measurement system. */
const INCHES = /[-_](US|LR|MM)\b/i.test(Intl.DateTimeFormat().resolvedOptions().locale ?? '');
const trim = (value: number) => value.toFixed(2).replace(/\.?0+$/, '');
export function formatLength(twips: number) {
  return INCHES ? `${trim(twips / 1440)} in` : `${trim(twips / 567)} cm`;
}

function SpaceStepper({ label, value, onChange }: { label: string; value: number; onChange: (points: number) => void }) {
  const colors = usePalette();
  const points = Math.max(0, Math.round(value / 20));
  return <View style={[styles.stepper, { borderColor: colors.separator }]}>
    <ThemedText style={styles.rowLabel}>{label}</ThemedText>
    <View style={styles.stepperControls}>
      <IconToggle icon={{ ios: 'minus', android: 'remove' }} label={`Less ${label.toLowerCase()}`} disabled={value >= 0 && points <= 0} onPress={() => onChange(Math.max(0, points - 6))} />
      <ThemedText style={styles.sizeValue}>{value < 0 ? 'Auto' : `${points} pt`}</ThemedText>
      <IconToggle icon={{ ios: 'plus', android: 'add' }} label={`More ${label.toLowerCase()}`} disabled={points >= 72} onPress={() => onChange(Math.min(72, points + 6))} />
    </View>
  </View>;
}

export function FormatSheet({ isPresented, onClose, tab, onTab, format, run, spacing }: FormatProps) {
  const colors = usePalette();
  const [ink, setInk] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  return <DocSheet title="Format" isPresented={isPresented} onClose={onClose}>
    <Segmented value={tab} onChange={onTab} options={[{ id: 'text', label: 'Text' }, { id: 'paragraph', label: 'Paragraph' }]} />
    {tab === 'text' ? <>
      <Label>Style</Label>
      <View style={[styles.card, { borderColor: colors.separator }]}>
        {DOC_STYLES.map((item, index) => <Pressable key={item.id} accessibilityRole="button" onPress={() => run('style', item.id)}
          style={({ pressed }) => [styles.styleRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }, { opacity: pressed ? 0.6 : 1 }]}>
          <ThemedText style={{ fontSize: item.size, lineHeight: item.size + 8, fontWeight: item.weight, color: item.id === 'subtitle' ? colors.secondaryLabel : colors.label }}>{item.label}</ThemedText>
        </Pressable>)}
      </View>
      <View style={styles.toolRow}>
        <IconToggle icon={{ ios: 'bold', android: 'format-bold' }} label="Bold" active={format.bold} onPress={() => run('bold')} />
        <IconToggle icon={{ ios: 'italic', android: 'format-italic' }} label="Italic" active={format.italic} onPress={() => run('italic')} />
        <IconToggle icon={{ ios: 'underline', android: 'format-underlined' }} label="Underline" active={format.underline} onPress={() => run('underline')} />
        <IconToggle icon={{ ios: 'strikethrough', android: 'format-strikethrough' }} label="Strikethrough" active={format.strike} onPress={() => run('strike')} />
      </View>
      <View style={[styles.stepper, { borderColor: colors.separator }]}>
        <ThemedText style={styles.rowLabel}>Size</ThemedText>
        <View style={styles.stepperControls}>
          <IconToggle icon={{ ios: 'minus', android: 'remove' }} label="Smaller text" disabled={format.size <= 6} onPress={() => run('size', String(Math.max(6, format.size - 1)))} />
          <ThemedText style={styles.sizeValue}>{format.size}</ThemedText>
          <IconToggle icon={{ ios: 'plus', android: 'add' }} label="Larger text" disabled={format.size >= 72} onPress={() => run('size', String(Math.min(72, format.size + 1)))} />
        </View>
      </View>
      <Label>Text colour</Label>
      <ColorSwatches value={ink} original={{ label: 'Automatic', value: null }} onChange={value => { setInk(value); run('color', colorValue(value)); }} />
      <Label>Highlight colour</Label>
      <ColorSwatches value={highlight} original={{ label: 'None', value: null }} onChange={value => { setHighlight(value); run('highlight', colorValue(value)); }} />
      <Row icon={{ ios: 'eraser', android: 'format-clear' }} label="Clear formatting" detail="Select text first" onPress={() => run('clear')} />
    </> : <>
      <Label>Alignment</Label>
      <Segmented value={format.align} onChange={value => run('align', value)} options={(['left', 'center', 'right', 'justify'] as const).map(id => ({ id, label: `Align ${id}`, icon: ALIGN_ICONS[id] }))} />
      <Label>Lists</Label>
      <Segmented value={format.list} onChange={value => run('list', value)} options={[
        { id: 'none', label: 'No list', icon: { ios: 'text.alignleft', android: 'notes' } },
        { id: 'bullet', label: 'Bulleted list', icon: { ios: 'list.bullet', android: 'format-list-bulleted' } },
        { id: 'decimal', label: 'Numbered list', icon: { ios: 'list.number', android: 'format-list-numbered' } },
      ]} />
      {spacing && <>
        <View style={[styles.stepper, { borderColor: colors.separator }]}>
          <View>
            <ThemedText style={styles.rowLabel}>Indent</ThemedText>
            <ThemedText style={[styles.rowDetail, { color: colors.secondaryLabel }]}>{formatLength(format.indent ?? 0)}</ThemedText>
          </View>
          <View style={styles.stepperControls}>
            <IconToggle icon={{ ios: 'decrease.indent', android: 'format-indent-decrease' }} label="Decrease indent" disabled={(format.indent ?? 0) <= 0} onPress={() => run('indent', 'out')} />
            <IconToggle icon={{ ios: 'increase.indent', android: 'format-indent-increase' }} label="Increase indent" disabled={(format.indent ?? 0) >= 7200} onPress={() => run('indent', 'in')} />
          </View>
        </View>
        <Label>Line spacing</Label>
        <Segmented value={lineChoice(format.line ?? 0)} onChange={value => run('line', value)} options={LINE_SPACING.map(id => ({ id, label: id }))} />
        <SpaceStepper label="Space before" value={format.before ?? -1} onChange={points => run('spaceBefore', String(points))} />
        <SpaceStepper label="Space after" value={format.after ?? -1} onChange={points => run('spaceAfter', String(points))} />
      </>}
    </>}
  </DocSheet>;
}

type InsertProps = {
  isPresented: boolean;
  onClose: () => void;
  docx: boolean;
  bands: boolean;
  onImage: () => void;
  onTable: (size: string) => void;
  onBands: (focus: 'header' | 'footer' | 'page') => void;
};

export function InsertSheet({ isPresented, onClose, docx, bands, onImage, onTable, onBands }: InsertProps) {
  const [table, setTable] = useState('2x2');
  const detail = docx ? undefined : 'Available after Save as DOCX';
  return <DocSheet title="Insert" isPresented={isPresented} onClose={onClose}>
    <Row icon={{ ios: 'photo', android: 'image' }} label="Image" detail={detail ?? 'From your device'} disabled={!docx} onPress={onImage} />
    <Row icon={{ ios: 'tablecells', android: 'table-chart' }} label="Table" detail={detail ?? `${table.replace('x', ' × ')} grid`} disabled={!docx} onPress={() => onTable(table)} />
    {docx && <View style={styles.chips}>
      {['2x2', '3x3', '4x4', '2x4'].map(size => <Chip key={size} label={size.replace('x', ' × ')} selected={table === size} onPress={() => setTable(size)} />)}
    </View>}
    <Row icon={{ ios: 'rectangle.topthird.inset.filled', android: 'vertical-align-top' }} label="Header" detail={detail ?? (bands ? undefined : 'Update the app build to use this')} disabled={!docx || !bands} onPress={() => onBands('header')} />
    <Row icon={{ ios: 'rectangle.bottomthird.inset.filled', android: 'vertical-align-bottom' }} label="Footer" detail={detail ?? (bands ? undefined : 'Update the app build to use this')} disabled={!docx || !bands} onPress={() => onBands('footer')} />
    <Row icon={{ ios: 'number', android: 'tag' }} label="Page numbers" detail={detail ?? (bands ? 'Shown on every page' : 'Update the app build to use this')} disabled={!docx || !bands} onPress={() => onBands('page')} />
  </DocSheet>;
}

type BandsProps = { isPresented: boolean; onClose: () => void; value: HeaderFooter; onApply: (value: HeaderFooter) => void };

export function HeaderFooterSheet({ isPresented, onClose, value, onApply }: BandsProps) {
  const [draft, setDraft] = useState(value);
  const [opened, setOpened] = useState(isPresented);
  if (isPresented !== opened) { setOpened(isPresented); if (isPresented) setDraft(value); }
  const set = (patch: Partial<HeaderFooter>) => setDraft(current => ({ ...current, ...patch }));
  const alignOptions = (['left', 'center', 'right'] as const).map(id => ({ id, label: `Align ${id}`, icon: ALIGN_ICONS[id] }));
  const pageBlocked = (draft.pagePos === 'header' && draft.headerLocked) || (draft.pagePos === 'footer' && draft.footerLocked);
  return <ToolSheet title="Header & footer" isPresented={isPresented} onClose={onClose}>
    <ScrollView contentContainerStyle={styles.bandsContent} keyboardShouldPersistTaps="handled">
      <BandEditor label="Header" locked={draft.headerLocked} text={draft.header} align={draft.headerAlign} alignOptions={alignOptions}
        onText={header => set({ header })} onAlign={headerAlign => set({ headerAlign })} />
      <BandEditor label="Footer" locked={draft.footerLocked} text={draft.footer} align={draft.footerAlign} alignOptions={alignOptions}
        onText={footer => set({ footer })} onAlign={footerAlign => set({ footerAlign })} />
      <Label>Page numbers</Label>
      <Segmented value={draft.pagePos} onChange={pagePos => set({ pagePos })} options={[
        { id: 'none', label: 'None' },
        { id: 'header', label: 'In header' },
        { id: 'footer', label: 'In footer' },
      ]} />
      {pageBlocked && <Note>That band came from another app and can’t hold page numbers here.</Note>}
      {draft.pagePos !== 'none' && <>
        <Label>Number position</Label>
        <Segmented value={draft.pageAlign} onChange={pageAlign => set({ pageAlign })} options={alignOptions} />
        <Label>Number style</Label>
        <Segmented value={draft.pageFormat} onChange={pageFormat => set({ pageFormat })} options={[
          { id: 'plain', label: '1' },
          { id: 'page', label: 'Page 1' },
          { id: 'pageOf', label: 'Page 1 of N' },
        ]} />
      </>}
      <Note>Headers and footers repeat on every page when the document is opened in Word, Google Docs or another editor, and in PDFs made here.</Note>
      <View style={styles.actions}>
        <ActionButton label="Remove all" onPress={() => setDraft(current => ({ ...EMPTY_BANDS, header: current.headerLocked ? current.header : '', footer: current.footerLocked ? current.footer : '', headerLocked: current.headerLocked, footerLocked: current.footerLocked }))} />
        <ActionButton label="Apply" primary disabled={!!pageBlocked} onPress={() => onApply(draft)} />
      </View>
    </ScrollView>
  </ToolSheet>;
}

function BandEditor({ label, locked, text, align, alignOptions, onText, onAlign }: { label: string; locked?: boolean; text: string; align: BandAlign; alignOptions: { id: BandAlign; label: string; icon: OptionIcon }[]; onText: (value: string) => void; onAlign: (value: BandAlign) => void }) {
  const colors = usePalette();
  return <View style={styles.band}>
    <Label>{label}</Label>
    {locked ? <Note>This {label.toLowerCase()} has content this editor can’t show, so it stays as it is.</Note> : <>
      <TextInput accessibilityLabel={`${label} text`} value={text} onChangeText={onText} placeholder={`${label} text`} placeholderTextColor={colors.secondaryLabel} multiline maxLength={400}
        style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface, textAlign: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left' }]} />
      <Segmented value={align} onChange={onAlign} options={alignOptions} />
    </>}
  </View>;
}

function Note({ children }: { children: ReactNode }) {
  const colors = usePalette();
  return <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{children}</ThemedText>;
}

function ActionButton({ label, primary = false, disabled = false, onPress }: { label: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, { backgroundColor: primary ? colors.wordInk : colors.accentSurface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
    <ThemedText style={[styles.actionLabel, { color: primary ? colors.systemBackground : colors.label }]}>{label}</ThemedText>
  </Pressable>;
}

export const PAPER = { a4: { w: 11906, h: 16838, label: 'A4' }, letter: { w: 12240, h: 15840, label: 'Letter' } } as const;
const MARGIN_PRESETS = [
  { id: 'normal', label: 'Normal', top: 1440, bottom: 1440, left: 1440, right: 1440 },
  { id: 'narrow', label: 'Narrow', top: 720, bottom: 720, left: 720, right: 720 },
  { id: 'moderate', label: 'Moderate', top: 1440, bottom: 1440, left: 1080, right: 1080 },
  { id: 'wide', label: 'Wide', top: 1440, bottom: 1440, left: 2880, right: 2880 },
] as const;
const MARGIN_STEP = INCHES ? 360 : 283.5;

export const paperName = (page: PageSetup) => (Object.values(PAPER).find(paper => Math.abs(paper.w - page.w) < 30 && Math.abs(paper.h - page.h) < 30)?.label) ?? `${formatLength(page.w)} × ${formatLength(page.h)}`;

type PageProps = { isPresented: boolean; onClose: () => void; value: PageSetup; onApply: (value: PageSetup) => void };

export function PageSetupSheet({ isPresented, onClose, value, onApply }: PageProps) {
  const colors = usePalette();
  const [draft, setDraft] = useState(value);
  const [opened, setOpened] = useState(isPresented);
  if (isPresented !== opened) { setOpened(isPresented); if (isPresented) setDraft(value); }
  const paper = (Object.keys(PAPER) as (keyof typeof PAPER)[]).find(id => Math.abs(PAPER[id].w - draft.w) < 30 && Math.abs(PAPER[id].h - draft.h) < 30);
  const preset = MARGIN_PRESETS.find(item => item.top === draft.top && item.bottom === draft.bottom && item.left === draft.left && item.right === draft.right)?.id;
  const maxSide = (draft.w - 2880) / 2;
  const maxEdge = (draft.h - 2880) / 2;
  const step = (side: 'top' | 'bottom' | 'left' | 'right', direction: 1 | -1) => setDraft(current => {
    const limit = side === 'top' || side === 'bottom' ? maxEdge : maxSide;
    return { ...current, [side]: Math.round(Math.min(limit, Math.max(0, current[side] + direction * MARGIN_STEP))) };
  });
  return <ToolSheet title="Page setup" isPresented={isPresented} onClose={onClose}>
    <ScrollView contentContainerStyle={styles.bandsContent}>
      <Label>Paper size</Label>
      <View style={styles.chipRow}>
        {(Object.keys(PAPER) as (keyof typeof PAPER)[]).map(id => <Chip key={id} label={`${PAPER[id].label} · ${formatLength(PAPER[id].w)} × ${formatLength(PAPER[id].h)}`} selected={paper === id}
          onPress={() => setDraft(current => ({ ...current, w: PAPER[id].w, h: PAPER[id].h }))} />)}
      </View>
      {!paper && <Note>This document uses a custom paper size ({paperName(draft)}). Pick one above to change it.</Note>}
      <Label>Margins</Label>
      <View style={styles.chipRow}>
        {MARGIN_PRESETS.map(item => <Chip key={item.id} label={item.label} selected={preset === item.id}
          onPress={() => setDraft(current => ({ ...current, top: item.top, bottom: item.bottom, left: item.left, right: item.right }))} />)}
      </View>
      {(['top', 'bottom', 'left', 'right'] as const).map(side => {
        const label = side[0].toUpperCase() + side.slice(1);
        const limit = side === 'top' || side === 'bottom' ? maxEdge : maxSide;
        return <View key={side} style={[styles.stepper, { borderColor: colors.separator }]}>
          <ThemedText style={styles.rowLabel}>{label}</ThemedText>
          <View style={styles.stepperControls}>
            <IconToggle icon={{ ios: 'minus', android: 'remove' }} label={`Smaller ${side} margin`} disabled={draft[side] <= 0} onPress={() => step(side, -1)} />
            <ThemedText style={styles.marginValue}>{formatLength(draft[side])}</ThemedText>
            <IconToggle icon={{ ios: 'plus', android: 'add' }} label={`Larger ${side} margin`} disabled={draft[side] >= limit} onPress={() => step(side, 1)} />
          </View>
        </View>;
      })}
      <Note>Margins set the white space around the text on every page, in the saved file and in PDFs made here.</Note>
      <View style={styles.actions}>
        <ActionButton label="Cancel" onPress={onClose} />
        <ActionButton label="Apply" primary onPress={() => onApply(draft)} />
      </View>
    </ScrollView>
  </ToolSheet>;
}

type MoreProps = {
  isPresented: boolean;
  onClose: () => void;
  format: 'docx' | 'txt';
  rotated: boolean;
  /** Page setup, ruler and page strip need native editor version 3. */
  layout: boolean;
  page: PageSetup;
  ruler: boolean;
  pages: boolean;
  onPageSetup: () => void;
  onRuler: () => void;
  onPages: () => void;
  /** `save` writes to the current file, `saveAs` creates a new one, `docx` saves a text file as a new DOCX. */
  onSave: (mode: 'save' | 'saveAs' | 'docx') => void;
  onPdf: () => void;
  onText: () => void;
  onRotate: () => void;
};

function Check({ on }: { on: boolean }) {
  const colors = usePalette();
  return <UniversalIcon ios={on ? 'checkmark.circle.fill' : 'circle'} android={on ? 'check-circle' : 'radio-button-unchecked'} size={24} color={on ? colors.wordInk : colors.secondaryLabel} />;
}

export function MoreSheet({ isPresented, onClose, format, rotated, layout, page, ruler, pages, onPageSetup, onRuler, onPages, onSave, onPdf, onText, onRotate }: MoreProps) {
  const update = layout ? undefined : 'Update the app build to use this';
  const margins = page.top === page.bottom && page.left === page.right && page.top === page.left ? formatLength(page.top) : `${formatLength(page.top)} top, ${formatLength(page.left)} sides`;
  return <DocSheet title="Options" isPresented={isPresented} onClose={onClose}>
    <Row icon={{ ios: 'square.and.arrow.down', android: 'save' }} label="Save" detail={format === 'docx' ? 'Word document (.docx)' : 'Plain text (.txt)'} onPress={() => onSave('save')} />
    <Row icon={{ ios: 'square.and.arrow.down.on.square', android: 'save-as' }} label="Save as" detail="Keeps the original and creates a new file" onPress={() => onSave('saveAs')} />
    {format === 'txt' && <Row icon={{ ios: 'doc.badge.plus', android: 'note-add' }} label="Save as DOCX" detail="Keeps formatting, images and tables" onPress={() => onSave('docx')} />}
    <Row icon={{ ios: 'doc.richtext', android: 'picture-as-pdf' }} label="Download as PDF" detail={layout ? `${paperName(page)} pages with headers and footers` : 'A simplified copy with headers and footers'} onPress={onPdf} />
    <Row icon={{ ios: 'doc.text', android: 'description' }} label="Save as plain text" detail="Text only, no formatting" onPress={onText} />
    <Label>Page</Label>
    <Row icon={{ ios: 'doc.on.doc', android: 'crop-portrait' }} label="Page setup" detail={update ?? (format === 'docx' ? `${paperName(page)} · margins ${margins}` : 'Available after Save as DOCX')} disabled={!layout || format !== 'docx'} onPress={onPageSetup} />
    <Label>View</Label>
    <Row icon={{ ios: 'ruler', android: 'straighten' }} label="Show ruler" detail={update} disabled={!layout} onPress={onRuler} trailing={layout ? <Check on={ruler} /> : undefined} />
    <Row icon={{ ios: 'square.grid.3x1.below.line.grid.1x2', android: 'view-carousel' }} label="Show pages" detail={update ?? 'Page previews with previous and next'} disabled={!layout} onPress={onPages} trailing={layout ? <Check on={pages} /> : undefined} />
    <Row icon={{ ios: 'rotate.right', android: 'screen-rotation' }} label={rotated ? 'Portrait view' : 'Landscape view'} onPress={onRotate} />
  </DocSheet>;
}

const styles = StyleSheet.create({
  sheet: { paddingBottom: s.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: s.lg, paddingBottom: s.sm, gap: s.md },
  sheetTitle: { ...t.heading, flex: 1 },
  sheetBody: { maxHeight: 520 },
  sheetContent: { paddingHorizontal: s.lg, paddingBottom: s.xl, gap: s.sm },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  toggle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  toolRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: s.xs },
  segmented: { flexDirection: 'row', borderRadius: radius.sm, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.sm - 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentLabel: { fontSize: 14, fontWeight: '600' },
  label: { ...t.caption, fontWeight: '700', marginTop: s.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  styleRow: { minHeight: 48, paddingHorizontal: s.md, justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 2 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  sizeValue: { minWidth: 32, textAlign: 'center', fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: s.lg },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16 },
  rowDetail: { ...t.caption },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, paddingLeft: 40 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm },
  marginValue: { minWidth: 72, textAlign: 'center', fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chip: { minHeight: 36, paddingHorizontal: s.md, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: 14, fontWeight: '600' },
  bandsContent: { padding: s.lg, gap: s.sm, paddingBottom: 48 },
  band: { gap: s.sm },
  input: { minHeight: 52, borderRadius: radius.sm, paddingHorizontal: s.md, paddingVertical: 12, fontSize: 16 },
  note: { ...t.caption },
  actions: { flexDirection: 'row', gap: s.md, marginTop: s.md },
  action: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 16, fontWeight: '600' },
});
