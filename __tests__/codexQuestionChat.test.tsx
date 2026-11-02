import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Keyboard, Text } from 'react-native';
import { ChatScreen } from '../src/ui/chat/ChatScreen';
import { useAgentChat } from '../src/ui/chat/useAgentChat';
import { agentTranscriptService } from '../src/services/NativeTranscriptService';
import type { AgentChatState, TranscriptToolPart } from '../src/agentChat';
import type { NativeAgentInteractionPrompt } from 'react-native-whip-ssh';
import type { HerdrClient } from '../src/services/HerdrClient';
import type { PaneInfo } from '../src/types';

jest.mock('../src/services/NativeTranscriptService', () => ({ agentTranscriptService: { reconcile: jest.fn(), subscribe: jest.fn() } }));
jest.mock('../src/hooks/useAgentChatOpen', () => ({ useAgentChatOpen: () => ({ open: jest.fn() }) }));
jest.mock('../src/hooks/useNativeChatRows', () => ({ useNativeChatRows: require('../test-support/mockChatRows').mockChatRows }));
jest.mock('../src/ui/chat/Composer', () => ({ Composer: () => null }));
jest.mock('../src/ui/chat/Markdown', () => ({ Markdown: () => null }));
jest.mock('../src/ui/shizuku/SessionAccessMenu', () => ({ SessionAccessMenu: () => null }));
jest.mock('../src/services/attachmentPaste', () => ({}));
jest.mock('../src/services/composerImagePaste', () => ({}));
jest.mock('../src/services/transcriptPolish', () => ({}));
jest.mock('../src/hooks/useAppActive', () => ({ useAppActive: () => true }));

const question: TranscriptToolPart = {
  type: 'tool', id: 'question', callId: 'call', tool: 'functions · request_user_input_async',
  state: { status: 'completed', input: { questions: '[{"title":"Which option do you prefer?","options":["A","B"]}]' },
    questions: [{ question: 'Which option do you prefer?', multiple: false, options: [{ label: 'A' }, { label: 'B' }] }],
    files: [], diagnostics: [], loaded: [] },
};
const message = { id: 'm', role: 'assistant' as const, parts: [question], diffs: [] };
const state: AgentChatState = { status: 'live', revision: 1, sessionId: 'agent', transcript: {
  sessionId: 'agent', messages: [message], turns: [{ id: 'turn', status: 'idle', assistants: [message], diffs: [] }],
} };
const queued: NativeAgentInteractionPrompt = { token: 'queue', kind: 'queued-question', summary: '1 question waiting',
  text: '• Queued follow-up inputs\n? 1 question · shift+← to answer', choices: [] };
const menu: NativeAgentInteractionPrompt = { token: 'menu', kind: 'menu', summary: 'Which option do you prefer?',
  text: '• Queued follow-up inputs\nWhich option do you prefer?\n› 1. A\n  2. B\n  3. Other\nenter submit   ⌃] skip   ⇧→ main prompt',
  choices: ['A', 'B', 'Other'].map((label, index) => ({ label, index, selected: index === 0 })) };
const read = jest.fn<Promise<NativeAgentInteractionPrompt | undefined>, [string, string]>();
const respond = jest.fn<Promise<void>, [string, string, string, string, string?]>();
const paste = jest.fn();
const client = { native: { agentInteractionPrompt: read, respondAgentInteraction: respond, submitPastes: paste } } as unknown as HerdrClient;
const pane = { terminal_id: 'terminal', pane_id: 'pane', agent: 'codex', agent_status: 'done', agent_session: { value: 'agent', agent: 'codex' } } as PaneInfo;
let root: ReactTestRenderer;
let chat: ReturnType<typeof useAgentChat>;
function Harness({ active = true, currentPane = pane }: { active?: boolean; currentPane?: PaneInfo }) {
  chat = useAgentChat({ hostSessionId: 'host', pane: currentPane, client, onRefresh: async () => {}, active });
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  read.mockResolvedValue(queued);
  respond.mockResolvedValue();
  jest.mocked(agentTranscriptService.reconcile).mockReturnValue({ type: 'bound', binding: { bindingToken: 'binding' }, state } as ReturnType<typeof agentTranscriptService.reconcile>);
  jest.mocked(agentTranscriptService.subscribe).mockImplementation((_token, listener) => { listener(state); return () => {}; });
});
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); }
  jest.useRealTimers();
});

test('a completed async question remains actionable after Herdr goes done and uses the TUI response path', async () => {
  await act(async () => { root = create(<Harness />); });
  expect(chat.prompt.prompt?.kind).toBe('queued-question');
  read.mockResolvedValue(menu);
  await act(async () => { await chat.prompt.respond('open'); });
  expect(respond).toHaveBeenCalledWith('terminal', 'binding', 'queue', 'open', '');
  read.mockResolvedValueOnce({ ...menu, token: 'moved', choices: menu.choices.map(choice => ({ ...choice, selected: choice.index === 1 })) }).mockResolvedValueOnce(undefined);
  await act(async () => { await chat.prompt.respond('choice:1'); });
  expect(respond).toHaveBeenCalledWith('terminal', 'binding', 'menu', 'choice:1');
  expect(respond).toHaveBeenCalledWith('terminal', 'binding', 'moved', 'enter');
  expect(paste).not.toHaveBeenCalled();
  expect(chat.prompt.prompt).toBeNull();
});

test('hidden chats cancel prompt discovery and ignore late reads', async () => {
  let finish!: (prompt: NativeAgentInteractionPrompt) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { root = create(<Harness />); });
  await act(async () => root.update(<Harness active={false} />));
  await act(async () => { finish(queued); await jest.advanceTimersByTimeAsync(4000); });
  expect(chat.prompt.prompt).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});

test('idle historical async questions stop polling when the live TUI has no question', async () => {
  read.mockResolvedValue(undefined);
  await act(async () => { root = create(<Harness />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(10000); });
  expect(read).toHaveBeenCalledTimes(3);
  expect(chat.prompt.prompt).toBeNull();
});

test('the rebuilt chat displays recorded title and choices, opens the live sheet, and submits a choice', async () => {
  await act(async () => { root = create(<ChatScreen hostSessionId="host" hostName="Host" pane={pane} client={client}
    onRefresh={async () => {}} onBack={() => {}} onOpenTerminal={() => {}} onOpenProject={() => {}} onOpenFile={() => {}}
    active onNeedVoiceKey={() => {}} />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  const text = () => root.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ');
  expect(root.root.findAllByProps({ testID: 'agent-question-notice' }).length).toBeGreaterThan(0);
  expect(text()).toContain('Which option do you prefer?');
  expect(text()).toContain('A');
  expect(text()).toContain('B');
  const button = (label: string) => root.root.findAll(node => typeof node.props.onPress === 'function').find(node => node.findAllByType(Text).some(child => [child.props.children].flat(Infinity).join('') === label))!;
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  expect(text()).toContain('Open question');
  read.mockResolvedValue(menu);
  await act(async () => { button('Open question').props.onPress(); });
  expect(dismiss).toHaveBeenCalled();
  expect(text()).toContain('Type your own answer below');
  read.mockResolvedValueOnce({ ...menu, token: 'moved', choices: menu.choices.map(choice => ({ ...choice, selected: choice.index === 1 })) }).mockResolvedValueOnce(undefined);
  await act(async () => { button('B').props.onPress(); });
  expect(respond).toHaveBeenCalledWith('terminal', 'binding', 'moved', 'enter');
});

test('blocked to done does not discard a live async question', async () => {
  await act(async () => { root = create(<Harness currentPane={{ ...pane, agent_status: 'blocked' }} />); });
  expect(chat.prompt.prompt?.token).toBe('queue');
  await act(async () => root.update(<Harness currentPane={pane} />));
  expect(chat.prompt.prompt?.token).toBe('queue');
});

test('a question replaced during cursor movement is never submitted', async () => {
  read.mockResolvedValue(menu);
  await act(async () => { root = create(<Harness />); });
  read.mockResolvedValue({ ...menu, token: 'new-question', summary: 'A different question' });
  await act(async () => { await chat.prompt.respond('choice:1'); });
  expect(respond).toHaveBeenCalledTimes(1);
  expect(chat.prompt.error).toContain('question changed');
});

test('the composer answers Codex Other with typed text, never a bracketed paste', async () => {
  read.mockResolvedValue(menu);
  await act(async () => { root = create(<Harness />); });
  read.mockResolvedValueOnce({ ...menu, token: 'other', choices: menu.choices.map(choice => ({ ...choice, selected: choice.index === 2 })) }).mockResolvedValueOnce(undefined);
  await act(async () => { await chat.send('My own answer'); });
  expect(respond).toHaveBeenCalledWith('terminal', 'binding', 'menu', 'choice:2');
  expect(respond).toHaveBeenCalledWith('terminal', 'binding', 'other', 'answer', 'My own answer');
  expect(paste).not.toHaveBeenCalled();
});
