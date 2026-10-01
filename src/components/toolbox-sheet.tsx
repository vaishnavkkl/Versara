import { useRef } from 'react';
import { Keyboard } from 'react-native';
import { AppBottomSheet } from './app-bottom-sheet';
import { ToolboxContent, type ToolboxProps } from './toolbox-content';

const SNAP = ['75%'];

export function ToolboxSheet({ visible, onClose, onAction, ...content }: ToolboxProps) {
  const pending = useRef<string | null>(null);
  function select(id: string) { if (pending.current) return; Keyboard.dismiss(); pending.current = id; onClose(); }
  function dismissed() { const id = pending.current; pending.current = null; if (id) onAction(id); }
  return <AppBottomSheet visible={visible} onClose={onClose} onDismissed={dismissed} snapPoints={SNAP}>
    <ToolboxContent {...content} onClose={onClose} onSelect={select} />
  </AppBottomSheet>;
}
