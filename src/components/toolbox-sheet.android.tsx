import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { Host } from '@expo/ui';
import { Box, ModalBottomSheet, RNHostView, type ModalBottomSheetRef } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height } from '@expo/ui/jetpack-compose/modifiers';
import { ToolboxContent, type ToolboxProps } from './toolbox-content';
import { useAppearance, usePalette } from '@/theme/colors';

// Material's sheet only has half/expanded anchors; size the expanded catalog explicitly.
const DRAG_HANDLE = 40;

export function ToolboxSheet({ visible, onClose, onAction, ...content }: ToolboxProps) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const sheetHeight = windowHeight * 0.75;
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
  function select(id: string) { if (pending.current) return; Keyboard.dismiss(); pending.current = id; onClose(); }
  // A full-window native Host can intercept sibling touches even with box-none.
  // Keep it only through the sheet's hide animation, then remove it entirely.
  if (!mounted) return null;
  return <Host colorScheme={mode} style={{ position: 'absolute', width: windowWidth, height: windowHeight }} pointerEvents="box-none">
    {mounted && <ModalBottomSheet ref={sheet} onDismissRequest={onClose} skipPartiallyExpanded showDragHandle containerColor={colors.sheetBackground} scrimColor={colors.scrim}>
      <Box modifiers={[fillMaxWidth(), height(Math.max(0, Math.round(sheetHeight) - DRAG_HANDLE))]}>
        <RNHostView><ToolboxContent {...content} onClose={onClose} onSelect={select} /></RNHostView>
      </Box>
    </ModalBottomSheet>}
  </Host>;
}
