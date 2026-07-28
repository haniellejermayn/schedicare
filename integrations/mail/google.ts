import { google, type gmail_v1 } from "googleapis";
import { authorizedClient } from "../oauth";
import type { InboundMail, MailDraft, MailProvider } from "./types";

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected (no OAuth tokens)");
  }
}

function toRaw(d: MailDraft): string {
  const lines = [
    `To: ${d.to}`,
    `Subject: ${d.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    d.body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

function decodeBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data)
      return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const part of payload.parts ?? []) {
    const nested = decodeBody(part);
    if (nested) return nested;
  }
  return "";
}

/**
 * Live Gmail. Drafts are created only after staff approval; sending is a
 * separate explicit action. Replies are read only from known thread ids.
 * Accepts an injected gmail_v1.Gmail client for test doubles.
 */
export class GmailProvider implements MailProvider {
  readonly name = "gmail" as const;
  private gm: gmail_v1.Gmail;

  constructor(injected?: gmail_v1.Gmail) {
    if (injected) {
      this.gm = injected;
    } else {
      const auth = authorizedClient();
      if (!auth) throw new GmailNotConnectedError();
      this.gm = google.gmail({ version: "v1", auth });
    }
  }

  async createDraft(d: MailDraft) {
    const res = await this.gm.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: toRaw(d), ...(d.threadId ? { threadId: d.threadId } : {}) } },
    });
    return { draftId: res.data.id ?? "", threadId: res.data.message?.threadId ?? undefined };
  }

  async updateDraft(draftId: string, d: MailDraft) {
    const res = await this.gm.users.drafts.update({
      userId: "me",
      id: draftId,
      requestBody: { message: { raw: toRaw(d), ...(d.threadId ? { threadId: d.threadId } : {}) } },
    });
    return { draftId: res.data.id ?? draftId };
  }

  async sendDraft(draftId: string) {
    const res = await this.gm.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    return { messageId: res.data.id ?? "", threadId: res.data.threadId ?? undefined };
  }

  async pollReplies(threadIds: string[], seenMessageIds: string[]): Promise<InboundMail[]> {
    const out: InboundMail[] = [];
    for (const threadId of threadIds) {
      const res = await this.gm.users.threads.get({ userId: "me", id: threadId, format: "full" });
      for (const msg of res.data.messages ?? []) {
        if (!msg.id || seenMessageIds.includes(msg.id)) continue;
        const labelIds = msg.labelIds ?? [];
        if (labelIds.includes("SENT") || labelIds.includes("DRAFT")) continue; // only inbound
        const from = msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
        out.push({
          providerMessageId: msg.id,
          threadId,
          from,
          body: decodeBody(msg.payload),
          receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
        });
      }
    }
    return out;
  }

  async profile(): Promise<{ emailAddress: string }> {
    const res = await this.gm.users.getProfile({ userId: "me" });
    return { emailAddress: res.data.emailAddress ?? "" };
  }
}
