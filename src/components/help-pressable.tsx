import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { usePalette } from '@/theme/colors';
import { useControlHelp } from './control-help';
import { MessageBubble, type BubbleAnchor } from './message-bubble';
import { controlHelpText } from './control-help-text';

function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : '').filter(Boolean).join(' ');
}

/** Dotted targets intercept actions only during help; regular controls retain their existing behavior. */
export function HelpPressable({ helpText, helpMode, helpOnLongPress = false, children, style, onPress, onLongPress, disabled, accessibilityState, ...props }: PressableProps & { helpText?: string; helpMode?: boolean; helpOnLongPress?: boolean }) {
  const help = useControlHelp();
  const colors = usePalette();
  const naming = helpMode ?? help?.active ?? false;
  const button = useRef<View>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [bubble, setBubble] = useState<{ anchor: BubbleAnchor; message: string; naming: boolean } | null>(null);
  const closeBubble = useCallback(() => setBubble(null), []);
  if (bubble && bubble.naming !== naming) setBubble(null);
  const show = () => {
    const label = helpText ?? props.accessibilityLabel ?? (typeof children === 'function' ? '' : textOf(children));
    button.current?.measureInWindow((x, y, width, height) => {
      if (mounted.current && width > 0 && height > 0) setBubble({ anchor: { x, y, width, height }, message: controlHelpText(label || 'Control', !!disabled), naming });
    });
  };
  return <>
    <Pressable {...props} ref={button} disabled={naming ? false : disabled} accessibilityState={{ ...accessibilityState, disabled: naming ? false : disabled ?? accessibilityState?.disabled }} accessibilityHint={naming ? 'Shows an explanation without performing this action' : props.accessibilityHint}
      onPress={event => naming ? show() : onPress?.(event)} onLongPress={naming || helpOnLongPress ? show : onLongPress}
      style={state => typeof style === 'function' ? style(state) : style}>
      {state => <>{typeof children === 'function' ? children(state) : children}{naming && <>
        <View pointerEvents="none" style={[styles.outline, styles.outlineBacking, { borderColor: colors.helpOutlineBacking }]} />
        <View pointerEvents="none" style={[styles.outline, { borderColor: colors.helpOutline }]} />
      </>}</>}
    </Pressable>
    {bubble && bubble.naming === naming && <MessageBubble anchor={bubble.anchor} message={bubble.message} onClose={closeBubble} />}
  </>;
}
const styles = StyleSheet.create({
  outline: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderStyle: 'dotted', borderRadius: 12 },
  outlineBacking: { borderWidth: 3, borderStyle: 'solid' },
});
