import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Column, Host, ModalBottomSheet, RNHostView, type ModalBottomSheetRef } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height } from '@expo/ui/jetpack-compose/modifiers';
import { ToolboxContent, type ToolboxProps } from './toolbox-content';
import { useAppearance, usePalette } from '@/theme/colors';

// Material's sheet only has half/expanded anchors, so a fixed content height gives the 3/4 detent.
const DRAG_HANDLE = 40;

export function ToolboxSheet({ visible, onClose, onAction, ...content }: ToolboxProps) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const { height: windowHeight } = useWindowDimensions();
  const sheet = useRef<ModalBottomSheetRef>(null);
  const pending = useRef<string | null>(null);
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const finish = useEffectEvent(() => {
    setMounted(false);
    const id = pending.current;
    pending.current = null;
    if (id) onAction(id);
  });
  useEffect(() => {
    if (visible) return;
    let cancelled = false;
    const done = () => { if (!cancelled) finish(); };
    if (sheet.current) void sheet.current.hide().then(done, done);
    else done();
    return () => { cancelled = true; };
  }, [visible]);
  function select(id: string) { pending.current = id; onClose(); }
  if (!mounted) return null;
  return <Host colorScheme={mode} style={{ position: 'absolute' }} pointerEvents="none">
    <ModalBottomSheet ref={sheet} onDismissRequest={onClose} skipPartiallyExpanded showDragHandle containerColor={colors.systemBackground}>
      <Column modifiers={[fillMaxWidth(), height(Math.round(windowHeight * 0.75) - DRAG_HANDLE)]}>
        <RNHostView><ToolboxContent {...content} onClose={onClose} onSelect={select} /></RNHostView>
      </Column>
    </ModalBottomSheet>
  </Host>;
}
