import { SafeAreaView } from 'react-native-safe-area-context';
import { EditedFilesScreen } from '@/features/files/edited-files-screen';

export default function EditedFilesRoute() {
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
    <EditedFilesScreen />
  </SafeAreaView>;
}
