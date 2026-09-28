import { useRef } from 'react';
import { Keyboard } from 'react-native';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { ToolboxContent, type ToolboxProps } from './toolbox-content';
import { useAppearance, usePalette } from '@/theme/colors';

export function ToolboxSheet({ visible, onClose, onAction, ...content }: ToolboxProps) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const pending = useRef<string | null>(null);
  function select(id: string) {
    if (pending.current) return;
    Keyboard.dismiss();
    pending.current = id;
    onClose();
  }
  function dismissed() { onClose(); const id = pending.current; pending.current = null; if (id) onAction(id); }
  return <Host colorScheme={mode}>
    <BottomSheet isPresented={visible} onDismiss={dismissed} snapPoints={['full']} showDragIndicator containerColor={colors.sheetBackground} contentPadding={0}>
      <RNHostView><ToolboxContent {...content} onClose={onClose} onSelect={select} /></RNHostView>
    </BottomSheet>
  </Host>;
}
