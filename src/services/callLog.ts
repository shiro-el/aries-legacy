import { hostCallLogOpen, hostCallLogRead, hostCallLogStop } from 'react-native-whip-ssh';
import type { NotificationRuntime } from './notificationRuntimeRegistry';

// Reads a host's retained call log (FORK.md entries 4, 9 and 11) through the
// notification runtime. Rust owns the snapshot, the `tail -F` stream and the
// deduplication; this side only merges revisions and keeps the list ordered.

export type CallUrgency = 'emergency' | 'urgent' | 'check' | 'record';
export const CALL_URGENCIES: readonly CallUrgency[] = ['emergency', 'urgent', 'check', 'record'];

export type HostCall = {
  callId: string;
  paneId: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  /** `call` from the call-human skill, `approval` from the hook. */
  kind: string;
  urgency: CallUrgency;
  title?: string;
  body?: string;
  /** Set when the host lowered the urgency the agent asked for. */
  requestedUrgency?: string;
  ineligibleReason?: string;
  reply?: string;
  replyStatus?: string;
};

type WireRecord = {
  call_id: string;
  pane_id: string;
  created_at: number;
  kind: string;
  urgency: string;
  title?: string | null;
  body?: string | null;
  requested_urgency?: string | null;
  ineligible_reason?: string | null;
  reply?: string | null;
  reply_status?: string | null;
};

function isUrgency(value: string): value is CallUrgency {
  return (CALL_URGENCIES as readonly string[]).includes(value);
}

function parse(json: string): HostCall[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error('Invalid call log');
  return (value as WireRecord[]).flatMap(record => {
    if (!record?.call_id || !isUrgency(record.urgency)) return [];
    return [{
      callId: record.call_id,
      paneId: record.pane_id,
      createdAt: record.created_at * 1000,
      kind: record.kind,
      urgency: record.urgency,
      title: record.title ?? undefined,
      body: record.body ?? undefined,
      requestedUrgency: record.requested_urgency ?? undefined,
      ineligibleReason: record.ineligible_reason ?? undefined,
      reply: record.reply ?? undefined,
      replyStatus: record.reply_status ?? undefined,
    }];
  });
}

/**
 * The log appends a new row for each revision of a call (claimed, answered,
 * failed), so a later row replaces an earlier one with the same ID.
 */
export function mergeCalls(current: readonly HostCall[], incoming: readonly HostCall[]): HostCall[] {
  if (incoming.length === 0) return current as HostCall[];
  const byId = new Map(current.map(call => [call.callId, call]));
  for (const call of incoming) byId.set(call.callId, call);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Calls that should interrupt the user while the app is open. */
export function interrupts(call: HostCall): boolean {
  return call.urgency !== 'record';
}

/** Starts following the log and returns what it already holds. */
export async function openCallLog(runtime: NotificationRuntime): Promise<HostCall[]> {
  return parse(await hostCallLogOpen(runtime.runtimeId));
}

/** Rows appended since the last read. Throws once the stream has dropped. */
export async function readCallLog(runtime: NotificationRuntime): Promise<HostCall[]> {
  return parse(await hostCallLogRead(runtime.runtimeId));
}

export async function stopCallLog(runtime: NotificationRuntime): Promise<void> {
  await hostCallLogStop(runtime.runtimeId);
}
