import { createContext, useContext, type Ref } from 'react';
import { TextInput, View, type StyleProp, type ViewStyle, type TextInputProps } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useControlHelp } from './control-help';
import { HelpPressable } from './help-pressable';

/** True inside AppBottomSheet: its fields must be BottomSheetTextInput so the sheet rises above the keyboard. */
export const InBottomSheetContext = createContext(false);

/**
 * The app's text field. Inside a bottom sheet it becomes the sheet's own input automatically, so the keyboard
 * never covers it. Help targets keep the input's layout and prevent typing while its explanation is shown.
 */
export function HelpTextInput({ sheet, ref, ...props }: TextInputProps & { sheet?: boolean; ref?: Ref<TextInput> }) {
  const help = useControlHelp();
  const inSheet = useContext(InBottomSheetContext);
  const Input = sheet ?? inSheet ? BottomSheetTextInput : TextInput;
  if (!help?.active) return <Input ref={ref as never} {...props} />;
  return <HelpPressable accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? props.placeholder ?? 'Text field'} style={props.style as StyleProp<ViewStyle>}>
    <View pointerEvents="none"><Input {...props} style={{ color: props.placeholderTextColor }} autoFocus={false} editable={false} /></View>
  </HelpPressable>;
}
export function HelpSheetTextInput(props: TextInputProps) { return <HelpTextInput {...props} sheet />; }
