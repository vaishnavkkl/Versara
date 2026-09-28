import { Redirect } from 'expo-router';
// Retired module links return to the current toolbox.
export default function Screen() { return <Redirect href="/(tabs)" />; }
