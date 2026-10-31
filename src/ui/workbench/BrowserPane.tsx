import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { HostRuntimeConnection } from 'react-native-whip-ssh';

import { bestEffortCleanup } from '../../services/backgroundOperations';
import type { Palette } from '../theme/tokens';
import { Notice, errorText } from './parts';
import type { WorkbenchStyles } from './styles';
import { browserTarget, loadsInBrowser } from './workbench';

type Page =
  | { state: 'blank' }
  | { state: 'opening'; address: string }
  | { state: 'open'; address: string; url: string; tunnel: { id: string; local: string; remote: string } | null }
  | { state: 'failed'; address: string; error: string };

type Props = {
  native: HostRuntimeConnection | null;
  s: WorkbenchStyles;
  palette: Palette;
};

/**
 * A plain web view for checking an agent's work. `localhost` and bare ports
 * resolve on the host through an SSH tunnel; other sites load from the phone.
 */
export function BrowserPane({ native, s, palette }: Props) {
  const [input, setInput] = useState('');
  const [page, setPage] = useState<Page>({ state: 'blank' });
  const [nav, setNav] = useState({ back: false, forward: false });
  const web = useRef<WebView>(null);
  const tunnelRef = useRef<{ id: string; native: HostRuntimeConnection } | null>(null);

  const closeTunnel = () => {
    const tunnel = tunnelRef.current;
    tunnelRef.current = null;
    if (tunnel) bestEffortCleanup(tunnel.native.stopPreview(tunnel.id), 'workbench-browser-tunnel');
  };
  useEffect(() => closeTunnel, []);

  const go = async (value: string) => {
    let target;
    try {
      target = browserTarget(value);
    } catch (reason) {
      setPage({ state: 'failed', address: value, error: errorText(reason) });
      return;
    }
    setInput(target.url);
    closeTunnel();
    if (!target.tunnel) {
      setPage({ state: 'open', address: target.url, url: target.url, tunnel: null });
      return;
    }
    if (!native) {
      setPage({ state: 'failed', address: target.url, error: 'The host is not connected, so its local ports cannot be reached.' });
      return;
    }
    setPage({ state: 'opening', address: target.url });
    try {
      const preview = await native.startWebPreview(target.url);
      tunnelRef.current = { id: preview.id, native };
      setPage({
        state: 'open',
        address: target.url,
        url: preview.url,
        tunnel: { id: preview.id, local: new URL(preview.url).origin, remote: new URL(target.url).origin },
      });
    } catch (reason) {
      setPage({ state: 'failed', address: target.url, error: errorText(reason) });
    }
  };

  // The address bar shows the host's address, not the phone-side tunnel port.
  const shown = (url: string) =>
    page.state === 'open' && page.tunnel && url.startsWith(page.tunnel.local)
      ? page.tunnel.remote + url.slice(page.tunnel.local.length)
      : url;

  return (
    <View style={s.fill}>
      <View style={s.toolbar}>
        <Pressable onPress={() => web.current?.goBack()} disabled={!nav.back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={6} style={[s.navButton, !nav.back && s.dim]}>
          <Text style={s.navLabel}>‹</Text>
        </Pressable>
        <Pressable onPress={() => web.current?.goForward()} disabled={!nav.forward} accessibilityRole="button" accessibilityLabel="Forward" hitSlop={6} style={[s.navButton, !nav.forward && s.dim]}>
          <Text style={s.navLabel}>›</Text>
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => { void go(input); }}
          placeholder="Port, address or search"
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
          style={s.address}
          accessibilityLabel="Address"
        />
        <Pressable
          onPress={() => {
            if (page.state === 'open') web.current?.reload();
            else if (page.state === 'failed') void go(page.address);
          }}
          disabled={page.state === 'blank' || page.state === 'opening'}
          accessibilityRole="button"
          accessibilityLabel="Reload"
          hitSlop={6}
          style={[s.navButton, (page.state === 'blank' || page.state === 'opening') && s.dim]}
        >
          <Text style={s.navLabel}>↻</Text>
        </Pressable>
      </View>
      {page.state === 'blank' && (
        <Notice
          s={s}
          palette={palette}
          title="Open a page"
          text="Type a port such as 5173 to open a dev server running on the host. Other addresses load from the phone."
        />
      )}
      {page.state === 'opening' && <Notice s={s} palette={palette} busy text={`Opening a tunnel to ${page.address}`} />}
      {page.state === 'failed' && (
        <Notice s={s} palette={palette} title="Can't open this page" text={page.error} action={{ label: 'Try again', onPress: () => { void go(page.address); } }} />
      )}
      {page.state === 'open' && (
        <WebView
          key={page.url}
          ref={web}
          style={s.web}
          source={{ uri: page.url }}
          originWhitelist={['http://*', 'https://*', 'about:*', 'data:*']}
          onShouldStartLoadWithRequest={request => loadsInBrowser(request.url)}
          onNavigationStateChange={state => {
            setNav({ back: state.canGoBack, forward: state.canGoForward });
            setInput(shown(state.url));
          }}
          setSupportMultipleWindows={false}
          allowsInlineMediaPlayback
          pullToRefreshEnabled
        />
      )}
    </View>
  );
}
