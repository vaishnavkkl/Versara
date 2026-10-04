import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { ColorSwatches, hexColor } from '@/components/color-swatches';
import { EditorOption } from '@/components/editor-option';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';

export type PdfAnnotation = {
  index: number; subtype: string; bounds: { x: number; y: number; width: number; height: number };
  contents: string; author: string; opacity: number; versara: boolean; deletable: boolean; editable: boolean;
};
export type AnnotationEdit = { subtype: string; remove?: boolean; color?: string; opacity?: number; dx?: number; dy?: number };
/** Keyed by `${page}:${index}`; pages are 1-based like the rest of the tool. */
export type AnnotationEdits = Record<string, AnnotationEdit>;

const LABELS: Record<string, string> = {
  note: 'Sticky note', freetext: 'Text box', line: 'Line', square: 'Rectangle', circle: 'Ellipse', polygon: 'Polygon', polyline: 'Connected lines',
  highlight: 'Highlight', underline: 'Underline', squiggly: 'Squiggly underline', strikeout: 'Strikethrough', stamp: 'Stamp or image',
  caret: 'Insertion mark', ink: 'Drawing', attachment: 'File attachment', redact: 'Redaction mark', other: 'Annotation',
};
const OPACITIES = [.25, .5, .75, 1];
const STEP = .01;

export const annotationKey = (page: number, index: number) => `${page}:${index}`;

/** Native editor commands; `page` limits the result to one 1-based page. */
export function annotationCommands(edits: AnnotationEdits, page?: number) {
  return Object.entries(edits).flatMap(([key, edit]) => {
    const [editPage, index] = key.split(':').map(Number);
    if (page !== undefined && editPage !== page) return [];
    return [{ kind: 'annotation', page: editPage - 1, index, ...edit }];
  });
}

export const PageAnnotationsPanel = memo(function PageAnnotationsPanel({ annotations, page, edits, focus, disabled, onFocus, onChange }: {
  annotations: PdfAnnotation[]; page: number; edits: AnnotationEdits; focus?: number; disabled: boolean;
  onFocus: (index: number | undefined) => void; onChange: (key: string, edit: AnnotationEdit | undefined) => void;
}) {
  const colors = usePalette();
  return <ScrollView style={styles.panel} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <ThemedText style={styles.heading}>Annotations on page {page}</ThemedText>
    {!annotations.length && <ThemedText style={{ color: colors.secondaryLabel }}>No annotations on this page. Form fields and links are not listed.</ThemedText>}
    {annotations.map(item => {
      const key = annotationKey(page, item.index);
      const edit = edits[key];
      const focused = focus === item.index;
      const update = (patch: Partial<AnnotationEdit>) => onChange(key, { ...edit, ...patch, subtype: item.subtype });
      const nudge = (x: number, y: number) => {
        const dx = Math.min(1 - item.bounds.x - item.bounds.width, Math.max(-item.bounds.x, (edit?.dx ?? 0) + x));
        const dy = Math.min(1 - item.bounds.y - item.bounds.height, Math.max(-item.bounds.y, (edit?.dy ?? 0) + y));
        update({ dx: Number(dx.toFixed(4)), dy: Number(dy.toFixed(4)) });
      };
      const detail = [item.versara ? 'Added by Versara' : item.author, item.contents].filter(Boolean).join(' · ');
      const status = edit?.remove ? 'Will be deleted' : edit ? 'Changed' : !item.deletable ? 'Locked by its author' : !item.editable ? 'Can be deleted' : '';
      return <View key={key} style={[styles.row, { backgroundColor: focused ? colors.accentSurface : colors.secondarySystemBackground, borderColor: focused ? colors.accent : colors.separator }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${focused ? 'Stop outlining' : 'Outline'} ${LABELS[item.subtype] ?? 'annotation'}`} disabled={disabled} onPress={() => onFocus(focused ? undefined : item.index)} style={styles.summary}>
          <ThemedText style={[styles.title, edit?.remove && styles.removed]}>{LABELS[item.subtype] ?? 'Annotation'}</ThemedText>
          {!!detail && <ThemedText numberOfLines={2} style={{ color: colors.secondaryLabel }}>{detail}</ThemedText>}
          {!!status && <ThemedText style={{ color: edit ? colors.accent : colors.secondaryLabel, fontSize: 13 }}>{status}</ThemedText>}
        </Pressable>
        <View style={styles.actions}>
          {item.deletable && <EditorOption compact label={edit?.remove ? 'Restore' : 'Delete'} disabled={disabled} onPress={() => edit?.remove ? onChange(key, undefined) : onChange(key, { subtype: item.subtype, remove: true })} />}
          {!!edit && !edit.remove && <EditorOption compact label="Undo changes" disabled={disabled} onPress={() => onChange(key, undefined)} />}
          {item.editable && !edit?.remove && <EditorOption compact label={focused ? 'Done' : 'Edit'} selected={focused} disabled={disabled} onPress={() => onFocus(focused ? undefined : item.index)} />}
        </View>
        {focused && item.editable && !edit?.remove && <View style={styles.editor}>
          <ThemedText style={styles.label}>Colour</ThemedText>
          <ColorSwatches value={edit?.color ? parseInt(edit.color.slice(1), 16) : null} original={{ label: 'Original', value: null }} disabled={disabled}
            onChange={value => update({ color: value === null ? undefined : hexColor(value) })} />
          <ThemedText style={styles.label}>Opacity</ThemedText>
          <View style={styles.actions}>
            {OPACITIES.map(value => <EditorOption key={value} compact label={`${Math.round(value * 100)}%`} selected={Math.abs((edit?.opacity ?? item.opacity) - value) < .01} disabled={disabled} onPress={() => update({ opacity: value })} />)}
          </View>
          <ThemedText style={styles.label}>Position</ThemedText>
          <View style={styles.actions}>
            <EditorOption compact label="Left" icon={{ ios: 'arrow.left', android: 'arrow-back' }} disabled={disabled} onPress={() => nudge(-STEP, 0)} />
            <EditorOption compact label="Up" icon={{ ios: 'arrow.up', android: 'arrow-upward' }} disabled={disabled} onPress={() => nudge(0, -STEP)} />
            <EditorOption compact label="Down" icon={{ ios: 'arrow.down', android: 'arrow-downward' }} disabled={disabled} onPress={() => nudge(0, STEP)} />
            <EditorOption compact label="Right" icon={{ ios: 'arrow.right', android: 'arrow-forward' }} disabled={disabled} onPress={() => nudge(STEP, 0)} />
          </View>
        </View>}
      </View>;
    })}
  </ScrollView>;
});

const styles = StyleSheet.create({
  panel: { maxHeight: '40%', flexGrow: 0 }, content: { gap: 10, padding: 12 },
  heading: { fontSize: 16, fontWeight: '700' }, label: { fontSize: 14, fontWeight: '600' }, title: { fontSize: 15, fontWeight: '600' },
  removed: { textDecorationLine: 'line-through', opacity: .6 },
  row: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 }, summary: { gap: 2, minHeight: 44, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, editor: { gap: 8 },
});
