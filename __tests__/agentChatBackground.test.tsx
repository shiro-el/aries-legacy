import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useAgentChat } from '../src/ui/chat/useAgentChat';
import { emptyTranscript, type AgentChatState } from '../src/agentChat';
import { agentTranscriptService } from '../src/services/NativeTranscriptService';
import type { HerdrClient } from '../src/services/HerdrClient';
import type { PaneInfo } from '../src/types';

jest.mock('../src/services/NativeTranscriptService', () => ({
  agentTranscriptService: { reconcile: jest.fn(), subscribe: jest.fn() },
}));
jest.mock('../src/hooks/useAgentChatOpen', () => ({
  useAgentChatOpen: () => ({ open: jest.fn() }),
}));
jest.mock('../src/hooks/useNativeChatRows', () => ({
  useNativeChatRows: () => ({ rows: [], ready: false }),
}));

test('hidden chats detach UI listeners and catch up with the latest transcript on resume', async () => {
  let latest: AgentChatState = { sessionId: 'agent', transcript: emptyTranscript('agent'), status: 'live', revision: 1 };
  const listeners = new Set<(state: AgentChatState) => void>();
  jest.mocked(agentTranscriptService.reconcile).mockReturnValue({
    type: 'bound', binding: { bindingToken: 'token' }, state: latest,
  } as ReturnType<typeof agentTranscriptService.reconcile>);
  jest.mocked(agentTranscriptService.subscribe).mockImplementation((_token, listener) => {
    listeners.add(listener);
    listener(latest);
    return () => { listeners.delete(listener); };
  });
  const client = { native: {} } as HerdrClient;
  const pane = { terminal_id: 'terminal', agent_session: { value: 'agent' } } as PaneInfo;
  let chat!: ReturnType<typeof useAgentChat>;
  function Harness({ active }: { active: boolean }) {
    chat = useAgentChat({ hostSessionId: 'host', pane, client, onRefresh: async () => {}, active });
    return null;
  }
  let root!: ReactTestRenderer;
  await act(async () => { root = create(<Harness active />); });
  expect(listeners.size).toBe(1);
  await act(async () => root.update(<Harness active={false} />));
  latest = { ...latest, revision: 10 };
  expect(listeners.size).toBe(0);
  expect(chat.state.revision).toBe(1);
  await act(async () => root.update(<Harness active />));
  expect(chat.state.revision).toBe(10);
  expect(listeners.size).toBe(1);
  await act(async () => root.unmount());
  expect(listeners.size).toBe(0);
});
