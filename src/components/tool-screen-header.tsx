import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { ScreenHeader } from './screen-header';
import { useControlHelp } from './control-help';
import { HelpButton } from './help-button';
import type { EditorMenuItem } from './editor-menu';
import { useHeaderActions } from './header-actions';
import { useHeaderOrientation } from './header-orientation';

/** Keep navigation visible; secondary actions share one labelled overflow menu. */
export function ToolScreenHeader({ tool, helpIntercept, menu = [], ...props }: Omit<ComponentProps<typeof ScreenHeader>, 'children'> & { tool?: string; helpIntercept?: () => boolean }) {
  const help = useControlHelp();
  const helpItem: EditorMenuItem = { id: 'control-help', label: 'Help with this tool', icon: { ios: 'questionmark.circle', android: 'help-outline' }, onPress: () => {
    if (helpIntercept?.()) return;
    if (help) help.toggle();
    else router.push({ pathname: '/guide', params: tool ? { tool } : {} });
  } };
  return <ScreenHeader {...props} menu={[...menu, helpItem]}>{help?.showing && <HelpButton tool={tool} intercept={helpIntercept} />}</ScreenHeader>;
}

export function ReaderScreenHeader(props: ComponentProps<typeof ToolScreenHeader>) {
  const actions = useHeaderActions();
  const orientation = useHeaderOrientation();
  return <ToolScreenHeader {...props} menu={[
    ...actions.map(({ ios, android, ...action }) => ({ ...action, icon: { ios, android } })),
    ...(orientation ? [{ id: 'orientation', label: orientation.landscape ? 'Portrait view' : 'Landscape view', disabled: orientation.disabled, icon: { ios: 'rotate.right' as const, android: 'screen-rotation' as const }, onPress: orientation.onToggle }] : []),
    ...(props.menu ?? []),
  ]} />;
}
