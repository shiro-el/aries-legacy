import type { CallUrgency } from '../../services/callLog';

export const URGENCY_LABEL: Readonly<Record<CallUrgency, string>> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  check: 'Check',
  record: 'Record',
};

/** What happened to the answer sent from a notification button. */
export function replyNote(status?: string): string {
  switch (status) {
    case 'delivered':
    case undefined:
      return '';
    case 'failed':
      return ', not delivered';
    default:
      return ', delivery not confirmed';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `14:02` today, `Oct 30 14:02` before that. */
export function formatCallTime(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const today = new Date(now);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay ? clock : `${MONTHS[date.getMonth()]} ${date.getDate()} ${clock}`;
}
