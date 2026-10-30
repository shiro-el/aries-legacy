import './src/logBoxWarnings';
import { registerRootComponent } from 'expo';
import './src/i18n';
import './src/services/remoteNotificationBackground';
import App from './App';

registerRootComponent(App);
