import { boot, err, json } from "@/lib/api";
import { findOpenSlots } from "@/core/scheduling";
import { demoToday } from "@/core/clock";
import { searchWindow } from "@/agents/scheduling";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  boot();
  const u = new URL(req.url);
  const doctorId = u.searchParams.get("doctorId");
  const type = u.searchParams.get("type") as "routine" | "follow_up" | "urgent" | null;
  if (!doctorId || !type) return err("doctorId and type are required");
  const fromDay = u.searchParams.get("fromDay") ?? demoToday();
  const toDay = u.searchParams.get("toDay") ?? searchWindow(fromDay, 7).toDay;
  const dayPart = (u.searchParams.get("dayPart") as "am" | "pm" | null) ?? undefined;
  const ignoreAppointmentId = u.searchParams.get("ignoreAppointmentId") ?? undefined;
  try {
    const slots = await findOpenSlots({ doctorId, type, fromDay, toDay, dayPart, ignoreAppointmentId, limit: 60 });
    return json({ slots });
  } catch (e) {
    return err(String((e as Error).message), 500);
  }
}
