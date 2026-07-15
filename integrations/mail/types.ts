export interface MailDraft {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}

export interface InboundMail {
  providerMessageId: string;
  threadId: string;
  from: string;
  body: string;
  receivedAt: string;
}

export interface MailProvider {
  readonly name: "gmail" | "simulated";
  createDraft(d: MailDraft): Promise<{ draftId: string; threadId?: string }>;
  updateDraft(draftId: string, d: MailDraft): Promise<{ draftId: string }>;
  /** Explicit, staff-approved send of an existing draft. */
  sendDraft(draftId: string): Promise<{ messageId: string; threadId?: string }>;
  /** Read replies only from known threads (never a general inbox scan). */
  pollReplies(threadIds: string[], seenMessageIds: string[]): Promise<InboundMail[]>;
}
