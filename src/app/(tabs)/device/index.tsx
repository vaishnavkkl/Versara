import { MethodScreen } from '@/components/method-screen';
import { DEVICE_SECTIONS } from '@/constants/device-methods';

export default function DeviceScreen() {
  return <MethodScreen title="Device" subtitle="Choose a tool to explore." sections={DEVICE_SECTIONS} />;
}
