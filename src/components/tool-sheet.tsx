import { createContext, useContext, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { radius, spacing as s, typography as t } from '@/theme/dashboard';

type Props = { title: string; isPresented: boolean; onClose: () => void; children: ReactNode };
const ReaderFocus = createContext<(focused: boolean) => void>(() => {});
export const useReaderFocus = () => useContext(ReaderFocus);

export function ToolSheet({ title, isPresented, onClose, children }: Props) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const [focused, setFocused] = useState(false);
  function close() { Keyboard.dismiss(); setFocused(false); onClose(); }
  return (
    <Host colorScheme={mode}>
      <BottomSheet isPresented={isPresented} onDismiss={close} snapPoints={['full']} showDragIndicator={false} contentPadding={{ top: 16, bottom: 0, left: 0, right: 0 }} containerColor={colors.systemBackground}>
        {/* A native sheet needs its own RN layout/touch root, including on iOS. */}
        <RNHostView>
          <View style={[styles.sheet, { backgroundColor: colors.systemBackground }]}>
            {!focused && <View style={[styles.header, { borderBottomColor: colors.separator }]}>
              <ThemedText accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</ThemedText>
              <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={close} style={({ pressed }) => [styles.close, { backgroundColor: colors.navBackground, borderColor: colors.navBorder, opacity: pressed ? 0.7 : 1 }]}>
                <UniversalIcon ios="xmark" android="close" size={24} color={colors.navIcon} />
              </Pressable>
            </View>}
            <ReaderFocus.Provider value={setFocused}><View style={styles.body}>{children}</View></ReaderFocus.Provider>
            {focused && <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={close} style={({ pressed }) => [styles.close, styles.floatingClose, { backgroundColor: colors.navBackground, borderColor: colors.navBorder, opacity: pressed ? 0.7 : 1 }]}><UniversalIcon ios="xmark" android="close" size={24} color={colors.navIcon} /></Pressable>}
          </View>
        </RNHostView>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: s.lg, paddingHorizontal: s.lg, paddingVertical: s.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...t.heading, flex: 1, minWidth: 0 },
  close: { width: 48, height: 48, flexShrink: 0, borderWidth: 1, borderRadius: radius.sm, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  floatingClose: { position: 'absolute', top: 8, right: 16, zIndex: 10, elevation: 6 },
  body: { flex: 1 },
});
