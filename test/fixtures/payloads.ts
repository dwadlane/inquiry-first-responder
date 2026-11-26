import type { MessageCreatedPayload } from '../../src/server/chatwoot.js';

/**
 * Shaped after what Chatwoot's AgentBotListener sends for message_created
 * (Message#webhook_data merged with event: "message_created").
 * All people and numbers are made up.
 */
export function messageCreated(over: {
  content?: string | null;
  convId?: number;
  status?: string;
  messageType?: string;
  isPrivate?: boolean;
  senderName?: string;
  senderEmail?: string | null;
  senderPhone?: string | null;
  attachments?: unknown[];
  event?: string;
  id?: number;
  createdAt?: string;
} = {}): MessageCreatedPayload & Record<string, unknown> {
  const convId = over.convId ?? 42;
  const p: MessageCreatedPayload & Record<string, unknown> = {
    event: over.event ?? 'message_created',
    id: over.id ?? 1001,
    content: over.content === undefined ? 'Hi, half my house has lost power' : over.content,
    content_type: 'text',
    content_attributes: {},
    additional_attributes: {},
    created_at: over.createdAt ?? '2026-11-06T02:14:09.000Z',
    message_type: over.messageType ?? 'incoming',
    private: over.isPrivate ?? false,
    source_id: null,
    account: { id: 1, name: 'Sample Account' },
    inbox: { id: 3, name: 'Website Chat' },
    conversation: {
      id: convId,
      inbox_id: 3,
      channel: 'Channel::WebWidget',
      status: over.status ?? 'pending',
      assignee_type: 'AgentBot',
      messages: [],
      labels: [],
      meta: { sender: { id: 77, name: over.senderName ?? 'patient-snowflake-514' } },
      unread_count: 1,
      waiting_since: 1793931249
    } as any,
    sender: {
      id: 77,
      name: over.senderName ?? 'patient-snowflake-514',
      email: over.senderEmail ?? null,
      phone_number: over.senderPhone ?? null,
      blocked: false,
      custom_attributes: {},
      additional_attributes: {}
    }
  };
  if (over.attachments) p.attachments = over.attachments;
  return p;
}
