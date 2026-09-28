import { MethodScreen } from '@/components/method-screen';
import { TOOLS } from '@/constants/tool-registry';

const sections = [{ title: 'Privacy tools', tools: TOOLS.filter(tool => tool.category === 'privacy').map(tool => ({ ...tool, subtitle: tool.description })) }];
export default function PrivacyScreen() {
  return <MethodScreen title="Privacy" subtitle="Keep sensitive details under your control." sections={sections} />;
}
