import { useEffect } from 'react';
import { NativeModules, View } from 'react-native';

// The UI layer was removed on purpose (FORK.md entry 16). The new UI mounts
// here on top of src/hooks, src/services and src/lib.
function hideLaunchScreen() {
  (NativeModules.WhipLaunchScreen as { hide(): void } | undefined)?.hide();
}

export default function App() {
  useEffect(hideLaunchScreen, []);
  return <View style={{ flex: 1 }} />;
}
