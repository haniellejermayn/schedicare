import { google, type gmail_v1 } from "googleapis";
import { authorizedClient } from "../oauth";
import type { InboundMail, MailDraft, MailProvider } from "./types";
import { normalizeMailBody } from "@/lib/mailText";

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected (no OAuth tokens)");
  }
}

/**
 * Plain-text email gets soft-folded around 78 columns by mail infrastructure
 * (RFC 2822 convention) regardless of the bytes we send — which shows up as
 * premature mid-paragraph line breaks. So the wire format is HTML: each
 * blank-line-separated paragraph becomes a <p>, remaining single newlines
 * (sign-off block, lists) become <br>. Paragraphs can never fold.
 */
function bodyToHtml(body: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = normalizeMailBody(body)
    .split(/\n{2,}/)
    .map(
      (p) => `<p style="margin:0 0 1em 0">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#17212b">${paras}</div>`;
}

function toRaw(d: MailDraft, replyToMessageId?: string): string {
  const lines = [
    `To: ${d.to}`,
    `Subject: ${d.subject}`,
    // RFC 2822 threading: Gmail groups the RECIPIENT's copy by these headers,
    // not by the API threadId — without them a threaded send still displays
    // as a new conversation in the inbox.
    ...(replyToMessageId
      ? [`In-Reply-To: ${replyToMessageId}`, `References: ${replyToMessageId}`]
      : []),
    'Content-Type: text/html; charset="UTF-8"',
    "MIME-Version: 1.0",
    "",
    bodyToHtml(d.body).replace(/\r?\n/g, "\r\n"),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

function decodeBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data)
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
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

  /** When threading, look up the thread's last RFC Message-ID so the raw
   * MIME carries In-Reply-To/References — required for the inbox copy to
   * display inside the conversation, not just share an API threadId. */
  private async lastMessageIdOf(threadId: string): Promise<string | undefined> {
    try {
      const t = await this.gm.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
        metadataHeaders: ["Message-ID"],
      });
      const msgs = t.data.messages ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const mid = msgs[i].payload?.headers?.find(
          (h) => h.name?.toLowerCase() === "message-id",
        )?.value;
        if (mid) return mid;
      }
    } catch {
      /* best effort — threadId alone still groups the sender's view */
    }
    return undefined;
  }

  async createDraft(d: MailDraft) {
    const replyTo = d.threadId
      ? await this.lastMessageIdOf(d.threadId)
      : undefined;
    const res = await this.gm.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: toRaw(d, replyTo),
          ...(d.threadId ? { threadId: d.threadId } : {}),
        },
      },
    });
    return {
      draftId: res.data.id ?? "",
      threadId: res.data.message?.threadId ?? undefined,
    };
  }

  async updateDraft(draftId: string, d: MailDraft) {
    const replyTo = d.threadId
      ? await this.lastMessageIdOf(d.threadId)
      : undefined;
    const res = await this.gm.users.drafts.update({
      userId: "me",
      id: draftId,
      requestBody: {
        message: {
          raw: toRaw(d, replyTo),
          ...(d.threadId ? { threadId: d.threadId } : {}),
        },
      },
    });
    return { draftId: res.data.id ?? draftId };
  }

  async sendDraft(draftId: string) {
    const res = await this.gm.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });
    return {
      messageId: res.data.id ?? "",
      threadId: res.data.threadId ?? undefined,
    };
  }

  async pollReplies(
    threadIds: string[],
    seenMessageIds: string[],
  ): Promise<InboundMail[]> {
    const out: InboundMail[] = [];
    for (const threadId of threadIds) {
      const res = await this.gm.users.threads.get({
        userId: "me",
        id: threadId,
        format: "full",
      });
      for (const msg of res.data.messages ?? []) {
        if (!msg.id || seenMessageIds.includes(msg.id)) continue;
        const labelIds = msg.labelIds ?? [];
        if (labelIds.includes("SENT") || labelIds.includes("DRAFT")) continue; // only inbound
        const from =
          msg.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")
            ?.value ?? "";
        out.push({
          providerMessageId: msg.id,
          threadId,
          from,
          body: decodeBody(msg.payload),
          receivedAt: msg.internalDate
            ? new Date(Number(msg.internalDate)).toISOString()
            : new Date().toISOString(),
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
