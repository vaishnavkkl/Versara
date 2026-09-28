import { useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { Host } from '@expo/ui';
import { BottomSheet, Group, RNHostView } from '@expo/ui/swift-ui';
import { frame, presentationBackground, presentationDetents, presentationDragIndicator } from '@expo/ui/swift-ui/modifiers';
import { ToolboxContent, type ToolboxProps } from './toolbox-content';
import { useAppearance, usePalette } from '@/theme/colors';

export function ToolboxSheet({ visible, onClose, onAction, ...content }: ToolboxProps) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const { height, width } = useWindowDimensions();
  const contentHeight = Math.max(0, height * 0.75 - 28);
  const pending = useRef<string | null>(null);
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  function select(id: string) { if (pending.current) return; pending.current = id; Keyboard.dismiss(); onClose(); }
  // Retain the presenter through dismissal, never over the closed reader.
  if (!mounted) return null;
  return <Host colorScheme={mode} style={{ position: 'absolute', width, height }} pointerEvents="box-none">
    <BottomSheet isPresented={visible} onIsPresentedChange={presented => { if (!presented) onClose(); }} onDismiss={() => { setMounted(false); const id = pending.current; pending.current = null; if (id) onAction(id); }}>
      <Group modifiers={[presentationDetents([{ height: contentHeight + 28 }]), presentationDragIndicator('visible'), presentationBackground(colors.sheetBackground), frame({ height: contentHeight })]}>
        <RNHostView><ToolboxContent {...content} onClose={onClose} onSelect={select} /></RNHostView>
      </Group>
    </BottomSheet>
  </Host>;
}
