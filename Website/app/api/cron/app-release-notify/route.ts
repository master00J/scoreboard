import { NextResponse } from "next/server";
import { getAppReleasePayload } from "@/lib/app-release";
import {
  completeAppReleaseNotification,
  reserveAppReleaseNotification,
} from "@/lib/app-release-notifications";
import { adminCollectActiveOwnerEmails } from "@/lib/license-admin-data";
import { sendLicenseUpdateAnnouncementEmail } from "@/lib/license-update-notify-email";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function cronGuard(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET ontbreekt." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Niet toegestaan." }, { status: 401 });
  }
  return null;
}

async function runReleaseNotification(request: Request) {
  const denied = cronGuard(request);
  if (denied) {
    return denied;
  }

  const envVersion = process.env.APP_RELEASE_VERSION?.trim();
  if (!envVersion) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "APP_RELEASE_VERSION ontbreekt; geen automatische update-mail verstuurd.",
    });
  }

  const release = getAppReleasePayload();
  const version = release.version.trim() || envVersion;
  const reserved = await reserveAppReleaseNotification({ version, release });
  if (!reserved.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: "Kon release-notificatie niet reserveren in Supabase.",
        status: reserved.status,
        error: reserved.text,
      },
      { status: 502 },
    );
  }

  if (!reserved.reserved) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Deze releaseversie is al verwerkt.",
      version,
      previousStatus: reserved.row?.status ?? null,
      sentAt: reserved.row?.sent_at ?? null,
    });
  }

  const collected = await adminCollectActiveOwnerEmails({ includeWebsiteDemo: false });
  if (!collected.ok) {
    const errors = ["Kon actieve licentiehouders niet ophalen."];
    await completeAppReleaseNotification({
      version,
      status: "failed",
      recipientCount: 0,
      sent: 0,
      failed: 0,
      errors,
    });
    return NextResponse.json(
      { ok: false, version, message: errors[0] },
      { status: 502 },
    );
  }

  const emails = collected.emails;
  let sent = 0;
  const failures: string[] = [];

  for (const to of emails) {
    const result = await sendLicenseUpdateAnnouncementEmail({
      to,
      version,
      changelogUrl: `${getSiteUrl()}/changelog`,
    });
    if (result.ok) {
      sent += 1;
    } else {
      failures.push(`${to}: ${result.error}`);
    }
    await sleep(450);
  }

  const completed = await completeAppReleaseNotification({
    version,
    status: failures.length > 0 ? "failed" : "sent",
    recipientCount: emails.length,
    sent,
    failed: failures.length,
    errors: failures,
  });
  if (!completed.ok) {
    return NextResponse.json(
      {
        ok: false,
        version,
        message: "Mails verwerkt, maar resultaat kon niet in Supabase opgeslagen worden.",
        recipientCount: emails.length,
        sent,
        failed: failures.length,
        errors: failures.length > 0 ? failures : undefined,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: failures.length === 0,
    version,
    recipientCount: emails.length,
    sent,
    failed: failures.length,
    errors: failures.length > 0 ? failures : undefined,
  });
}

export async function GET(request: Request) {
  return runReleaseNotification(request);
}

export async function POST(request: Request) {
  return runReleaseNotification(request);
}
