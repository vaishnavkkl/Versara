import { Platform, ToastAndroid } from 'react-native';

/** Native Android toast for long-running work; iOS already shows progress in place. */
export function toast(message: string, long = false) {
  if (Platform.OS === 'android') ToastAndroid.show(message, long ? ToastAndroid.LONG : ToastAndroid.SHORT);
}
