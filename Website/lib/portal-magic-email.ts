import { Resend } from "resend";
import { getSiteUrl } from "@/lib/site-url";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Verstuurt een eenmalige loginlink voor het klantportaal.
 */
export async function sendPortalMagicLinkEmail(opts: {
  email: string;
  verifyUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY ontbreekt" };
  }

  const from = process.env.RESEND_FROM?.trim() || "ArenaCue <info@arenacue.be>";
  const site = getSiteUrl();
  const verifyUrl = opts.verifyUrl.trim();

  const resend = new Resend(apiKey);
  const html = `
    <p>Hallo,</p>
    <p>Je hebt een loginlink aangevraagd voor het <strong>ArenaCue klantportaal</strong>.</p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(verifyUrl)}"
         style="display:inline-block;padding:12px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
        Inloggen op klantportaal
      </a>
    </p>
    <p style="color:#666;font-size:13px;">Deze link vervalt binnen 15 minuten. Als je dit niet zelf aanvroeg, mag je deze mail negeren.</p>
    <p style="color:#666;font-size:12px;">Als de knop niet werkt, kopieer en plak deze URL in je browser:<br/>
      <span style="word-break:break-all;">${escapeHtml(verifyUrl)}</span>
    </p>
    <p style="margin-top:24px;color:#666;font-size:13px;">Met vriendelijke groet,<br/>ArenaCue</p>
  `.trim();

  const text = [
    "Je loginlink voor het ArenaCue klantportaal:",
    "",
    verifyUrl,
    "",
    "Deze link vervalt binnen 15 minuten.",
    "",
    `Website: ${site}`,
  ].join("\n");

  const result = await resend.emails.send({
    from,
    to: [opts.email.trim().toLowerCase()],
    subject: "Je loginlink voor ArenaCue klantportaal",
    text,
    html,
  });

  if (result.error) {
    return { ok: false, error: String(result.error.message ?? result.error) };
  }
  return { ok: true };
}
