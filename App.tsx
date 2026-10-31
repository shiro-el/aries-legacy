import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { chatAgentForPane } from './src/lib/agentChatSession';
import { reportBackgroundFailure } from './src/services/backgroundOperations';
import { ChatScreen } from './src/ui/chat/ChatScreen';
import { DeleteHostPrompt, HostKeyPrompt, LockScreen } from './src/ui/Gate';
import { TabBar, type MainTab } from './src/ui/TabBar';
import { HerdScreen, type SavedHost } from './src/ui/herd/HerdScreen';
import { NewTaskSheet, type NewTaskHost } from './src/ui/herd/NewTaskSheet';
import { herdSection } from './src/ui/herd/herdSections';
import { HostEditor } from './src/ui/hosts/HostEditor';
import { HostsScreen, type HostRow } from './src/ui/hosts/HostsScreen';
import { TerminalScreen } from './src/ui/terminal/TerminalScreen';
import { fontAssets, palettes, usePalette } from './src/ui/theme/tokens';
import { useAppRuntime } from './src/ui/useAppRuntime';
import type { HostProfile } from './src/types';

// The new UI mounts here on top of src/hooks, src/services and src/lib
// (FORK.md entry 16).
type ChatRef = { sessionId: string; paneId: string };
const RETAINED_CHATS = 3;
const chatKey = (ref: ChatRef) => `${ref.sessionId}:${ref.paneId}`;

function hideLaunchScreen() {
  (NativeModules.WhipLaunchScreen as { hide(): void } | undefined)?.hide();
}

export default function App() {
  const [fontsLoaded] = useFonts(fontAssets);
  const palette = usePalette();
  const { hosts, sessions, security, navigation, terminals, preferences } = useAppRuntime();
  const { presentationSessions, activeSession, terminalTargets } = sessions;

  useEffect(() => {
    if (fontsLoaded) hideLaunchScreen();
  }, [fontsLoaded]);

  const tab: MainTab = navigation.state.tab === 'hosts' || navigation.state.tab === 'terminal'
    ? navigation.state.tab
    : 'herd';

  const sections = useMemo(() => presentationSessions.map(herdSection), [presentationSessions]);
  const needYou = sections.reduce((sum, section) => sum + section.view.needYou, 0);
  const terminalCount = presentationSessions.reduce((sum, session) => sum + session.terminalRail.terminals.length, 0);

  const savedHosts = useMemo<SavedHost[]>(() => {
    const live = new Set(presentationSessions.map(session => session.hostId));
    return hosts.hosts
      .filter(host => !live.has(host.id))
      .map(host => ({ hostId: host.id, name: host.name, connecting: sessions.connectingHostIds.has(host.id) }));
  }, [hosts.hosts, presentationSessions, sessions.connectingHostIds]);

  const hostRows = useMemo<HostRow[]>(() => hosts.hosts.map(host => ({
    host,
    status: presentationSessions.find(session => session.hostId === host.id)?.connectionStatus,
    connecting: sessions.connectingHostIds.has(host.id),
  })), [hosts.hosts, presentationSessions, sessions.connectingHostIds]);

  // Hosts whose herd is live can start a task.
  const taskHosts = useMemo<NewTaskHost[]>(() => sections.flatMap(section => {
    if (section.state !== 'ready') return [];
    const session = presentationSessions.find(candidate => candidate.id === section.sessionId);
    return [{
      sessionId: section.sessionId,
      hostId: section.hostId,
      hostName: section.hostName,
      paneFolders: (session?.snapshot.panes ?? []).map(pane => pane.foreground_cwd ?? pane.cwd ?? ''),
    }];
  }), [presentationSessions, sections]);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const connectHost = useCallback((host: HostProfile) => {
    void sessions.connectSavedHost(host);
  }, [sessions]);

  const connectById = (hostId: string) => {
    const host = hosts.hosts.find(candidate => candidate.id === hostId);
    if (host) connectHost(host);
  };

  // Agent panes open as a conversation; plain shells open as a terminal.
  const [chat, setChat] = useState<ChatRef | null>(null);
  // Recently read conversations stay mounted while hidden, so going back to
  // one shows it at once instead of rebuilding its rows.
  const [recentChats, setRecentChats] = useState<ChatRef[]>([]);
  // A chat opened by starting a task, so its composer takes the caret.
  const [freshChat, setFreshChat] = useState<string | null>(null);
  useEffect(() => {
    if (!chat) return;
    setRecentChats(current => [chat, ...current.filter(entry => chatKey(entry) !== chatKey(chat))].slice(0, RETAINED_CHATS));
  }, [chat]);
  // Include the open chat in the same render it was opened in.
  const retainedChats = (chat && !recentChats.some(entry => chatKey(entry) === chatKey(chat))
    ? [chat, ...recentChats].slice(0, RETAINED_CHATS)
    : recentChats
  ).filter(entry => presentationSessions.some(session => session.id === entry.sessionId));
  const chatSession = chat ? presentationSessions.find(session => session.id === chat.sessionId) : undefined;
  const chatShown = chat !== null && chatSession !== undefined && tab === 'herd';

  useEffect(() => {
    if (!chatShown) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setChat(null);
      return true;
    });
    return () => subscription.remove();
  }, [chatShown]);

  const openPane = (sessionId: string, paneId: string) => {
    const pane = presentationSessions
      .find(session => session.id === sessionId)
      ?.snapshot.panes.find(candidate => candidate.pane_id === paneId);
    if (!pane) return;
    if (chatAgentForPane(pane)) setChat({ sessionId, paneId });
    else sessions.openPaneTerminal(sessionId, pane);
  };

  const activeTerminalId = activeSession?.terminalRail.activeTerminalId;
  const terminalTarget = activeSession
    ? terminalTargets.find(target => target.hostSessionId === activeSession.id && target.session.terminalId === activeTerminalId)
      ?? terminalTargets.find(target => target.hostSessionId === activeSession.id)
      ?? null
    : null;

  const selectTerminal = (terminalId: string) => {
    if (!activeSession) return;
    const entry = activeSession.terminalRail.terminals.find(candidate => candidate.terminalId === terminalId);
    const pane = activeSession.snapshot.panes.find(candidate => candidate.pane_id === entry?.paneId);
    if (pane) sessions.activatePaneTerminal(activeSession.id, pane);
  };

  const editing = hosts.editorProfile;
  const editingSaved = editing ? hosts.hosts.find(host => host.id === editing.id) : undefined;

  if (!fontsLoaded) return null;

  const terminalShown = tab === 'terminal' && !security.locked;
  const chrome = terminalShown ? palettes.dark : palette;

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar style={terminalShown ? 'light' : 'auto'} />
        <SafeAreaView style={{ flex: 1, backgroundColor: chrome.bg }}>
          {security.locked ? (
            <LockScreen authenticating={security.authenticating} onUnlock={() => { void security.authenticateLockedApp(); }} />
          ) : (
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
              {retainedChats.map(entry => {
                const session = presentationSessions.find(candidate => candidate.id === entry.sessionId);
                if (!session) return null;
                const pane = session.snapshot.panes.find(candidate => candidate.pane_id === entry.paneId);
                const visible = chatShown && chat !== null && chatKey(chat) === chatKey(entry);
                return (
                  <View key={chatKey(entry)} style={visible ? { flex: 1 } : { display: 'none' }}>
                    <ChatScreen
                      hostSessionId={entry.sessionId}
                      hostName={session.host.name}
                      pane={pane}
                      client={sessions.getClient(entry.sessionId)}
                      onRefresh={() => sessions.refresh(entry.sessionId)}
                      active={visible}
                      focusComposer={freshChat === chatKey(entry)}
                      onBack={() => setChat(null)}
                      onOpenTerminal={() => {
                        if (pane) sessions.openPaneTerminal(entry.sessionId, pane);
                      }}
                    />
                  </View>
                );
              })}
              {tab === 'herd' && !chatShown && (
                <HerdScreen
                  sections={sections}
                  savedHosts={savedHosts}
                  error={hosts.error}
                  onConnect={connectById}
                  onOpenPane={openPane}
                  onNewTask={taskHosts.length > 0 ? () => setNewTaskOpen(true) : undefined}
                />
              )}
              {tab === 'hosts' && (
                <HostsScreen
                  rows={hostRows}
                  loaded={hosts.profilesLoaded}
                  error={editing ? null : hosts.error}
                  onAdd={hosts.openManualHost}
                  onEdit={host => { void hosts.openEditor(host); }}
                  onConnect={connectHost}
                  onDisconnect={host => { void sessions.closeHostById(host.id); }}
                />
              )}
              {terminalShown && (
                <TerminalScreen
                  session={activeSession}
                  target={terminalTarget}
                  fontSize={preferences.terminal.fontSize}
                  onBack={() => {
                    if (activeSession) sessions.exitTerminalToHerd(activeSession.id);
                    else navigation.selectTab('herd');
                  }}
                  onSelectTerminal={selectTerminal}
                  onCloseTerminal={terminalId => {
                    if (activeSession) sessions.closeTerminal(activeSession.id, terminalId);
                  }}
                  onStatus={(terminalId, status, error) => {
                    if (activeSession) terminals.updateStatus(activeSession.id, terminalId, status, error);
                  }}
                />
              )}
              <TabBar
                tab={tab}
                needYou={needYou}
                terminalCount={terminalCount}
                onSelect={next => {
                  // Tapping Herd while reading a conversation returns to the herd.
                  if (next === 'herd' && tab === 'herd') setChat(null);
                  navigation.selectTab(next);
                }}
              />
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
        <HostEditor
          profile={editing}
          existing={editingSaved !== undefined}
          error={hosts.error}
          onSave={hosts.saveHost}
          onCancel={hosts.closeEditor}
          onDelete={() => {
            if (editingSaved) hosts.confirmDelete(editingSaved);
          }}
        />
        <DeleteHostPrompt
          name={hosts.deleteHostTarget ? hosts.deleteHostTarget.name || hosts.deleteHostTarget.host : null}
          busy={hosts.deleteHostBusy}
          onCancel={hosts.cancelDelete}
          onConfirm={() => { void hosts.deleteConfirmed(); }}
        />
        <NewTaskSheet
          visible={newTaskOpen}
          hosts={taskHosts}
          runtime={sessionId => sessions.getClient(sessionId)?.activeNative ?? null}
          onClose={() => setNewTaskOpen(false)}
          onCreate={async (sessionId, label, cwd, launch) => {
            await sessions.createWorkspace(sessionId, label, cwd, launch, (pane, agentStarted) => {
              if (agentStarted) {
                const ref = { sessionId, paneId: pane.pane_id };
                setFreshChat(chatKey(ref));
                setChat(ref);
                navigation.selectTab('herd');
              } else {
                // A shell, or an agent that failed to start: show the pane as it is.
                sessions.openPaneTerminal(sessionId, pane);
              }
            });
            // The new pane shows up in the herd without waiting for the next event.
            reportBackgroundFailure(sessions.refresh(sessionId), 'new-task-refresh');
          }}
        />
        <HostKeyPrompt challenge={hosts.unknownHostChallenge} onResolve={hosts.resolveUnknownHost} />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
