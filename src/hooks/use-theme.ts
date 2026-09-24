import { Colors } from '@/constants/theme';
import { useAppearance } from '@/theme/colors';

export function useTheme() {
  return Colors[useAppearance(state => state.mode)];
}
