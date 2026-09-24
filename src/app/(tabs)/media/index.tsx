import { Redirect } from 'expo-router';

// Preserve existing Media links while Image and Video have separate screens.
export default function MediaRedirect() {
  return <Redirect href="/(tabs)/image" />;
}
