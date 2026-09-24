import { useEffect, useRef } from 'react';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { ToolboxContent, type ToolboxProps } from './toolbox-content';
import { useAppearance, usePalette } from '@/theme/colors';

// SwiftUI sheet dismissal takes ~0.3s; tools start once it is off screen.
const DISMISS_MS = 360;

export function ToolboxSheet({ visible, onClose, onAction, ...content }: ToolboxProps) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function select(id: string) {
    onClose();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onAction(id), DISMISS_MS);
  }
  return <Host colorScheme={mode}>
    <BottomSheet isPresented={visible} onDismiss={onClose} snapPoints={[{ fraction: 0.75 }]} showDragIndicator containerColor={colors.systemBackground} contentPadding={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <RNHostView><ToolboxContent {...content} onClose={onClose} onSelect={select} /></RNHostView>
    </BottomSheet>
  </Host>;
}
