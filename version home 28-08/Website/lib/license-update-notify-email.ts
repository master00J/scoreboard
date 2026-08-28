import { Resend } from "resend";
import { getSiteUrl } from "@/lib/site-url";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendLicenseUpdateAnnouncementEmail(opts: {
  to: string;
  version: string;
  changelogUrl?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY ontbreekt" };
  }

  const from = process.env.RESEND_FROM?.trim() || "ArenaCue <info@arenacue.be>";
  const site = getSiteUrl();
  const version = opts.version.trim();
  const portalUrl = `${site}/portal`;
  const changelog =
    opts.changelogUrl && opts.changelogUrl.trim().length > 0
      ? opts.changelogUrl.trim()
      : null;

  const resend = new Resend(apiKey);
  const subject = `ArenaCue — software-update (${version})`;

  const html = `
    <p>Hallo,</p>
    <p>Er is een <strong>nieuwe versie</strong> van ArenaCue-software uitgebracht: <strong>${escapeHtml(version)}</strong>.</p>
    <p>Als je een lopende licentie hebt, kun je de nieuwe build downloaden via het <strong>klantportaal</strong> (zelfde e-mailadres als bij je licentie):</p>
    <p style="margin:20px 0;">
      <a href="${escapeHtml(portalUrl)}"
         style="display:inline-block;padding:12px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
        Naar klantportaal
      </a>
    </p>
    ${
      changelog
        ? `<p>Meer lezen: <a href="${escapeHtml(changelog)}">${escapeHtml(changelog)}</a></p>`
        : ""
    }
    <p style="color:#666;font-size:13px;">Heb je vragen bij de update? Antwoord gerust op deze mail of neem contact op via <a href="mailto:info@arenacue.be">info@arenacue.be</a>.</p>
    <p style="margin-top:20px;color:#666;font-size:13px;">Met vriendelijke groet,<br/>ArenaCue</p>
  `.trim();

  const textLines = [
    `Er is een nieuwe ArenaCue-softwareversie: ${version}.`,
    "",
    `Download via het klantportaal: ${portalUrl}`,
  ];
  if (changelog) {
    textLines.push("", `Changelog / info: ${changelog}`);
  }
  textLines.push("", "Met vriendelijke groet,", "ArenaCue");
  const text = textLines.join("\n");

  const result = await resend.emails.send({
    from,
    to: [opts.to.trim().toLowerCase()],
    subject,
    text,
    html,
  });

  if (result.error) {
    return { ok: false, error: String(result.error.message ?? result.error) };
  }
  return { ok: true };
}
