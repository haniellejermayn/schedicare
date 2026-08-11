import { describe, expect, it } from "vitest";
import { weekDayKeys } from "@/components/WeekCalendar";

describe("WeekCalendar week boundaries", () => {
  it("always returns the containing Sunday-to-Saturday week", () => {
    expect(weekDayKeys("2026-08-12")).toEqual([
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
    expect(weekDayKeys("2026-08-09")[0]).toBe("2026-08-09");
  });
});
