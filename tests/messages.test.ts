import { describe, expect, it } from "vitest";
import { latestReplyOnly } from "@/core/messages";

describe("latestReplyOnly", () => {
  it("removes a folded Gmail reply header and quoted history", () => {
    const raw = [
      "hello i actually can't do that time po",
      "",
      "On Sun, Aug 9, 2026 at 10:33 PM Clinic <clinic@example.com>",
      "wrote:",
      "> Hi Grace,",
      "> Here is the old message.",
    ].join("\r\n");

    expect(latestReplyOnly(raw)).toBe(
      "hello i actually can't do that time po",
    );
  });

  it("preserves a newest reply that has no quoted history", () => {
    expect(latestReplyOnly("Yes, that works. Thank you!\r\n")).toBe(
      "Yes, that works. Thank you!",
    );
  });
});
