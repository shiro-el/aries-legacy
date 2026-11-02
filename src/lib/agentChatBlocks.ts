import type { AgentTranscript, TranscriptPart, TranscriptQuestion, TranscriptToolPart } from '../agentChat';

export function isRunningTool(part: TranscriptToolPart): boolean {
  return part.state.status === 'pending' || part.state.status === 'running';
}

const QUESTION_TOOLS = new Set(['question', 'askuserquestion', 'request_user_input', 'request_user_input_async']);
export function isQuestionTool(part: TranscriptToolPart): boolean {
  return QUESTION_TOOLS.has(part.tool.toLowerCase().split(' · ').at(-1)?.split('.').at(-1) ?? '');
}

export type RecordedQuestionTarget = {
  turnId: string;
  messageId: string;
  part: TranscriptPart;
  questionIndex: number;
  question: TranscriptQuestion;
};

/** Only the newest question in the latest turn, with no subsequent user reply. */
export function latestUnansweredRecordedQuestion(transcript: AgentTranscript): RecordedQuestionTarget | null {
  const turn = transcript.turns.at(-1);
  if (!turn) return null;
  const currentMessages = new Set((turn.messages ?? turn.assistants).map(message => message.id));
  for (let index = transcript.messages.length - 1; index >= 0; index--) {
    const message = transcript.messages[index];
    if (message.role === 'user') return null;
    if (!currentMessages.has(message.id)) continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex];
      const questions = part.type === 'tool' && isQuestionTool(part)
        ? part.state.questions : part.type === 'notice' ? part.questions : undefined;
      const question = questions?.at(-1);
      if (question && questions) return { turnId: turn.id, messageId: message.id, part, questionIndex: questions.length - 1, question };
    }
  }
  return null;
}
