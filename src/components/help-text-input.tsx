import { TextInput, View, type StyleProp, type ViewStyle, type TextInputProps } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useControlHelp } from './control-help';
import { HelpPressable } from './help-pressable';

/** Help targets keep the input's layout and prevent typing while its explanation is shown. */
export function HelpTextInput({ sheet = false, ...props }: TextInputProps & { sheet?: boolean }) {
  const help = useControlHelp();
  const Input = sheet ? BottomSheetTextInput : TextInput;
  if (!help?.active) return <Input {...props} />;
  return <HelpPressable accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? props.placeholder ?? 'Text field'} style={props.style as StyleProp<ViewStyle>}>
    <View pointerEvents="none"><Input {...props} style={{ color: props.placeholderTextColor }} autoFocus={false} editable={false} /></View>
  </HelpPressable>;
}
export function HelpSheetTextInput(props: TextInputProps) { return <HelpTextInput {...props} sheet />; }
