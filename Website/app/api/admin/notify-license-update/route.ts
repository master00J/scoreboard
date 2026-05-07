import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGuardOrNotifyToken } from "@/lib/admin-route-guard";
import { adminCollectActiveOwnerEmails } from "@/lib/license-admin-data";
import { sendLicenseUpdateAnnouncementEmail } from "@/lib/license-update-notify-email";

const bodySchema = z.object({
  version: z.string().trim().min(1).max(64),
  changelogUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  dryRun: z.boolean().optional(),
  includeWebsiteDemo: z.boolean().optional(),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: Request) {
  const denied = await adminGuardOrNotifyToken(request);
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ongeldige JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Controleer de velden.", errors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const { version, dryRun, includeWebsiteDemo } = parsed.data;
  const changelogUrl =
    parsed.data.changelogUrl === "" || parsed.data.changelogUrl === null || parsed.data.changelogUrl === undefined
      ? null
      : parsed.data.changelogUrl;

  const collected = await adminCollectActiveOwnerEmails({
    includeWebsiteDemo: includeWebsiteDemo ?? false,
  });
  if (!collected.ok) {
    return NextResponse.json(
      { ok: false, message: "Kon licenties niet ophalen (Supabase niet bereikbaar?)." },
      { status: 502 },
    );
  }

  const emails = collected.emails;
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      recipientCount: emails.length,
      recipients: emails,
    });
  }

  let sent = 0;
  const failures: string[] = [];
  for (const to of emails) {
    const r = await sendLicenseUpdateAnnouncementEmail({ to, version, changelogUrl });
    if (r.ok) {
      sent += 1;
    } else {
      failures.push(`${to}: ${r.error}`);
    }
    await sleep(450);
  }

  return NextResponse.json({
    ok: failures.length === 0,
    dryRun: false,
    recipientCount: emails.length,
    sent,
    failed: failures.length,
    errors: failures.length ? failures : undefined,
  });
}
