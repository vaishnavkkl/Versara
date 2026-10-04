import type { ReactNode } from 'react';
import { Keyboard, StyleSheet } from 'react-native';
import { HelpSheetTextInput as BottomSheetTextInput } from '@/components/help-text-input';
import { OptionCard, OptionSheet } from '@/components/option-sheet';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { usePalette } from '@/theme/colors';

/** File settings stay in the same place across PDF operations. */
export function PdfFileOptionsSheet({ visible, onClose, name, onName, disabled, onChoose, chooseLabel = 'Change PDF', description, children }: {
  visible: boolean; onClose: () => void; name: string; onName: (name: string) => void; disabled: boolean;
  onChoose?: () => void; chooseLabel?: string; description?: string; children?: ReactNode;
}) {
  const colors = usePalette();
  return <OptionSheet title="PDF options" icon={{ ios: 'slider.horizontal.3', android: 'tune' }} isPresented={visible} onClose={onClose} keyboardInput>
    <OptionCard title="Output" icon={{ ios: 'doc', android: 'description' }}>
      <ThemedText>New PDF name</ThemedText>
      <BottomSheetTextInput accessibilityLabel="New PDF name" value={name} onChangeText={onName} editable={!disabled} maxLength={100} returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
        style={[styles.input, { color: colors.label, backgroundColor: colors.fieldSurface }]} />
    </OptionCard>
    {children}
    {description && <ThemedText style={{ color: colors.secondaryLabel }}>{description}</ThemedText>}
    {onChoose && <ToolButton title={chooseLabel} secondary disabled={disabled} onPress={() => { Keyboard.dismiss(); onClose(); onChoose(); }} />}
  </OptionSheet>;
}
const styles = StyleSheet.create({ input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 } });
