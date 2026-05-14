import { NextResponse } from "next/server";
import { generateWeeklySeoPost } from "@/lib/seo-posts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cronGuard(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, message: "CRON_SECRET ontbreekt." }, { status: 500 });
  }
  const auth = request.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Niet toegestaan." }, { status: 401 });
  }
  return null;
}

function brusselsScheduleState(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Brussels",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return {
    isThursday: weekday === "Thu",
    hour,
    minute,
  };
}

async function runSeoPostCron(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const schedule = brusselsScheduleState();
  if (!force && (!schedule.isThursday || schedule.hour !== 20 || schedule.minute !== 10)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "SEO-cron draait alleen donderdag om 20:10 Europe/Brussels.",
      schedule,
    });
  }

  try {
    const result = await generateWeeklySeoPost({ force });
    return NextResponse.json(result, { status: result.ok ? 200 : result.status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return runSeoPostCron(request);
}

export async function POST(request: Request) {
  return runSeoPostCron(request);
}
