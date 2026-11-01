import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, NativeModules, View } from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { SessionAccessActions } from './src/ui/shizuku/SessionAccessMenu';
import { chatAgentForPane } from './src/lib/agentChatSession';
import { useAppQueryLifecycle } from './src/hooks/useAppQueryLifecycle';
import { appQueryClient } from './src/services/appQueryClient';
import { reportBackgroundFailure } from './src/services/backgroundOperations';
import { ChatScreen } from './src/ui/chat/ChatScreen';
import { DeleteHostPrompt, HostKeyPrompt, LockScreen } from './src/ui/Gate';
import { CallBanner } from './src/ui/calls/CallBanner';
import { CallsScreen, type CallPane } from './src/ui/calls/CallsScreen';
import { useHostCalls } from './src/ui/calls/useHostCalls';
import { TabBar, type MainTab } from './src/ui/TabBar';
import { HerdScreen, type SavedHost } from './src/ui/herd/HerdScreen';
import { NewTaskSheet, type NewTaskHost } from './src/ui/herd/NewTaskSheet';
import { herdSection } from './src/ui/herd/herdSections';
import { HostEditor } from './src/ui/hosts/HostEditor';
import { HostNotificationsSheet } from './src/ui/hosts/HostNotificationsSheet';
import { HostsScreen, type HostRow } from './src/ui/hosts/HostsScreen';
import { TerminalScreen } from './src/ui/terminal/TerminalScreen';
import { fontAssets, palettes, usePalette } from './src/ui/theme/tokens';
import { useAppRuntime } from './src/ui/useAppRuntime';
import { WorkbenchScreen } from './src/ui/workbench/WorkbenchScreen';
import type { WorkbenchMode } from './src/ui/workbench/workbench';
import type { FileLink } from './src/ui/chat/fileLinks';
import type { HostProfile } from './src/types';

// The new UI mounts here on top of src/hooks, src/services and src/lib
// (FORK.md entry 16).
type ChatRef = { sessionId: string; paneId: string };
const RETAINED_CHATS = 3;
const chatKey = (ref: ChatRef) => `${ref.sessionId}:${ref.paneId}`;
/** The project screen for one pane: which mode it opens in and, from a chat link, which file. */
type WorkbenchRef = ChatRef & { mode: WorkbenchMode; file?: FileLink };

function hideLaunchScreen() {
  (NativeModules.WhipLaunchScreen as { hide(): void } | undefined)?.hide();
}

export default function App() {
  useAppQueryLifecycle();
  return (
    <QueryClientProvider client={appQueryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

function AppContent() {
  const [fontsLoaded] = useFonts(fontAssets);
  const palette = usePalette();
  const { hosts, sessions, security, navigation, terminals, openNotificationPaneRef, preferences, setPreference } = useAppRuntime();
  const calls = useHostCalls();
  const { presentationSessions, activeSession, terminalTargets } = sessions;

  useEffect(() => {
    if (fontsLoaded) hideLaunchScreen();
  }, [fontsLoaded]);

  // The core's `more` tab is where calls live now. A terminal fills the screen
  // in place of the tabs; it opens from a shell pane in the herd.
  const tab: MainTab | 'terminal' = navigation.state.tab === 'hosts' || navigation.state.tab === 'terminal'
    ? navigation.state.tab
    : navigation.state.tab === 'more' ? 'calls' : 'herd';
  const selectTab = (next: MainTab) => navigation.selectTab(next === 'calls' ? 'more' : next);

  // Reading Calls clears its count, including calls that arrive while it is open.
  const { markSeen, unseen } = calls;
  useEffect(() => {
    if (tab === 'calls' && unseen > 0) markSeen();
  }, [markSeen, tab, unseen]);

  const sections = useMemo(() => presentationSessions.map(herdSection), [presentationSessions]);
  const needYou = sections.reduce((sum, section) => sum + section.view.needYou, 0);

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
  // Files, changes and the browser open over the chat they were opened from.
  const [workbench, setWorkbench] = useState<WorkbenchRef | null>(null);
  const workbenchSession = workbench ? presentationSessions.find(session => session.id === workbench.sessionId) : undefined;
  const workbenchPane = workbenchSession?.snapshot.panes.find(candidate => candidate.pane_id === workbench?.paneId);
  const workbenchShown = workbench !== null && workbenchSession !== undefined && tab === 'herd';
  const chatShown = chat !== null && chatSession !== undefined && tab === 'herd' && !workbenchShown;
  const closeWorkbench = useCallback(() => setWorkbench(null), []);

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
  // A notification names a pane that may only just have been restored.
  openNotificationPaneRef.current = (sessionId, pane) => {
    if (!chatAgentForPane(pane)) {
      sessions.openPaneTerminal(sessionId, pane);
      return;
    }
    setWorkbench(null);
    setChat({ sessionId, paneId: pane.pane_id });
    navigation.selectTab('herd');
  };

  const activeTerminalId = activeSession?.terminalRail.activeTerminalId;
  const terminalTarget = activeSession
    ? terminalTargets.find(target => target.hostSessionId === activeSession.id && target.session.terminalId === activeTerminalId)
      ?? terminalTargets.find(target => target.hostSessionId === activeSession.id)
      ?? null
    : null;

  const sessionAccess = (sessionId: string, terminalId: string | undefined): SessionAccessActions | undefined => {
    const native = sessions.getClient(sessionId)?.activeNative;
    const session = presentationSessions.find(entry => entry.id === sessionId);
    const control = session?.agentControls.find(entry => entry.terminalId === terminalId);
    if (!terminalId || !control) return undefined;
    return {
      control,
      connected: !!native && (session?.connectionStatus === 'ready' || session?.connectionStatus === 'connected'),
      onChange: (enabled, shizukuAccess) => sessions.setAgentReverseControl(sessionId, terminalId, enabled, shizukuAccess),
      onRestart: () => sessions.restartAgent(sessionId, terminalId),
    };
  };

  const selectTerminal = (terminalId: string) => {
    if (!activeSession) return;
    const entry = activeSession.terminalRail.terminals.find(candidate => candidate.terminalId === terminalId);
    const pane = activeSession.snapshot.panes.find(candidate => candidate.pane_id === entry?.paneId);
    if (pane) sessions.activatePaneTerminal(activeSession.id, pane);
  };

  const hostName = (hostId: string) => {
    const host = hosts.hosts.find(candidate => candidate.id === hostId);
    return host ? host.name || host.host : 'Removed host';
  };

  const callPane = (hostId: string, paneId: string): CallPane | null => {
    const session = presentationSessions.find(candidate => candidate.hostId === hostId);
    const pane = session?.snapshot.panes.find(candidate => candidate.pane_id === paneId);
    if (!session || !pane) return null;
    const tabLabel = session.snapshot.tabs.find(candidate => candidate.tab_id === pane.tab_id)?.label;
    const agent = pane.display_agent ?? pane.agent ?? 'shell';
    return { sessionId: session.id, label: tabLabel ? `${tabLabel}, ${agent}` : agent };
  };

  const openCallPane = (sessionId: string, paneId: string) => {
    selectTab('herd');
    openPane(sessionId, paneId);
  };

  const [alertsHost, setAlertsHost] = useState<HostProfile | null>(null);
  // Counts the composer's requests for a Groq key; cleared when Hosts is left.
  const [voiceKeyRequest, setVoiceKeyRequest] = useState(0);
  const openVoiceKey = () => {
    setVoiceKeyRequest(current => current + 1);
    selectTab('hosts');
  };
  useEffect(() => {
    if (tab !== 'hosts') setVoiceKeyRequest(0);
  }, [tab]);
  const alertsHostConnected = alertsHost !== null && hostRows.some(row =>
    row.host.id === alertsHost.id && (row.status === 'connected' || row.status === 'ready'));

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
              <CallBanner
                arrived={calls.arrived}
                hostName={hostName}
                onDismiss={calls.dismissArrived}
                onOpen={arrived => {
                  calls.dismissArrived();
                  const pane = callPane(arrived.hostId, arrived.call.paneId);
                  if (pane) openCallPane(pane.sessionId, arrived.call.paneId);
                  else selectTab('calls');
                }}
              />
              {retainedChats.map(entry => {
                const session = presentationSessions.find(candidate => candidate.id === entry.sessionId);
                if (!session) return null;
                const pane = session.snapshot.panes.find(candidate => candidate.pane_id === entry.paneId);
                const visible = chatShown && chat !== null && chatKey(chat) === chatKey(entry);
                return (
                  <View key={chatKey(entry)} style={visible ? { flex: 1 } : { display: 'none' }}>
                    <ChatScreen
                      sessionAccess={sessionAccess(entry.sessionId, pane?.terminal_id)}
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
                      onOpenProject={() => setWorkbench({ ...entry, mode: 'files' })}
                      onOpenFile={file => setWorkbench({ ...entry, mode: 'files', file })}
                      onNeedVoiceKey={openVoiceKey}
                    />
                  </View>
                );
              })}
              {workbenchShown && workbench && (
                <WorkbenchScreen
                  key={`${chatKey(workbench)}:${workbench.mode}:${workbench.file ? `${workbench.file.path}:${workbench.file.line ?? ''}` : ''}`}
                  initialMode={workbench.mode}
                  initialFile={workbench.file}
                  native={sessions.getClient(workbench.sessionId)?.activeNative ?? null}
                  client={sessions.getClient(workbench.sessionId) ?? null}
                  cwd={workbenchPane?.foreground_cwd
                    ?? workbenchPane?.cwd
                    ?? workbenchSession?.snapshot.workspaces.find(item => item.workspace_id === workbenchPane?.workspace_id)?.worktree?.checkout_path
                    ?? '~'}
                  backLabel={chat ? 'Chat' : 'Herd'}
                  onClose={closeWorkbench}
                />
              )}
              {tab === 'herd' && !chatShown && !workbenchShown && (
                <HerdScreen
                  sections={sections}
                  savedHosts={savedHosts}
                  error={hosts.error}
                  onConnect={connectById}
                  onOpenPane={openPane}
                  onReviewPane={(sessionId, paneId) => setWorkbench({ sessionId, paneId, mode: 'changes' })}
                  onNewTask={taskHosts.length > 0 ? () => setNewTaskOpen(true) : undefined}
                />
              )}
              {tab === 'calls' && (
                <CallsScreen logs={calls.logs} hostName={hostName} pane={callPane} onOpenPane={openCallPane} />
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
                  onNotifications={setAlertsHost}
                  alerts={preferences}
                  onAlertsChange={setPreference}
                  voiceKeyRequest={voiceKeyRequest}
                />
              )}
              {terminalShown && (
                <TerminalScreen
                  sessionAccess={activeSession ? sessionAccess(activeSession.id, terminalTarget?.session.terminalId) : undefined}
                  session={activeSession}
                  target={terminalTarget}
                  fontSize={preferences.terminal.fontSize}
                  onBack={() => {
                    if (activeSession) sessions.exitTerminalToHerd(activeSession.id);
                    else selectTab('herd');
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
              {tab !== 'terminal' && (
                <TabBar
                  tab={tab}
                  needYou={needYou}
                  unseenCalls={calls.unseen}
                  onSelect={next => {
                    // Tapping Herd while reading a conversation returns to the herd.
                    if (next === 'herd' && tab === 'herd') {
                      setWorkbench(null);
                      setChat(null);
                    }
                    selectTab(next);
                  }}
                />
              )}
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
        <HostNotificationsSheet
          host={alertsHost ? { id: alertsHost.id, name: alertsHost.name || alertsHost.host } : null}
          connected={alertsHostConnected}
          onClose={() => setAlertsHost(null)}
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
