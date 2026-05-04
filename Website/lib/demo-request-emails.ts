import { Resend } from "resend";
import type { DemoRequestInput } from "@/lib/demo-request";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linesForNotify(data: DemoRequestInput): string {
  const phone = data.phone?.trim() || "—";
  const message = data.message?.trim() || "—";
  return [
    `Naam: ${data.name}`,
    `E-mail: ${data.email}`,
    `Club/organisatie: ${data.club}`,
    `Telefoon: ${phone}`,
    "",
    "Bericht:",
    message,
  ].join("\n");
}

function notifyHtml(data: DemoRequestInput): string {
  const phone = escapeHtml(data.phone?.trim() || "—");
  const message = escapeHtml(data.message?.trim() || "—").replace(/\r\n|\n/g, "<br/>");
  return `
    <p>Er is een nieuwe demo-aanvraag via de website.</p>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Naam</td><td>${escapeHtml(data.name)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">E-mail</td><td>${escapeHtml(data.email)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Club</td><td>${escapeHtml(data.club)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Telefoon</td><td>${phone}</td></tr>
    </table>
    <p style="margin-top:16px;color:#555;">Bericht</p>
    <p style="margin:0;">${message}</p>
  `.trim();
}

function autoReplyHtml(name: string): string {
  const first = escapeHtml(name.split(/\s+/)[0] || name);
  return `
    <p>Hallo ${first},</p>
    <p>Bedankt voor je interesse in <strong>ArenaCue</strong>. We hebben je demo-aanvraag goed ontvangen.</p>
    <p>We nemen zo snel mogelijk contact met je op om een demo in te plannen.</p>
    <p style="margin-top:24px;color:#666;font-size:13px;">Met vriendelijke groet,<br/>Het ArenaCue-team</p>
  `.trim();
}

function autoReplyText(name: string): string {
  const first = name.split(/\s+/)[0] || name;
  return [
    `Hallo ${first},`,
    "",
    "Bedankt voor je interesse in ArenaCue. We hebben je demo-aanvraag goed ontvangen.",
    "",
    "We nemen zo snel mogelijk contact met je op om een demo in te plannen.",
    "",
    "Met vriendelijke groet,",
    "Het ArenaCue-team",
  ].join("\n");
}

/**
 * Verstuurt (1) een notificatie naar het team en (2) een bevestiging naar de aanvrager.
 * Faalt stil als RESEND_API_KEY ontbreekt; logt errors bij mislukte verzending.
 */
export async function sendDemoRequestEmails(data: DemoRequestInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return;
  }

  const from = process.env.RESEND_FROM?.trim() || "ArenaCue <info@arenacue.be>";
  const notifyTo = process.env.DEMO_NOTIFY_EMAIL?.trim() || "info@arenacue.be";

  const resend = new Resend(apiKey);

  const [notifyResult, autoReplyResult] = await Promise.all([
    resend.emails.send({
      from,
      to: [notifyTo],
      replyTo: data.email,
      subject: `Nieuwe demo-aanvraag: ${data.name}`,
      text: linesForNotify(data),
      html: notifyHtml(data),
    }),
    resend.emails.send({
      from,
      to: [data.email],
      replyTo: notifyTo,
      subject: "Je demo-aanvraag bij ArenaCue",
      text: autoReplyText(data.name),
      html: autoReplyHtml(data.name),
    }),
  ]);

  if (notifyResult.error) {
    console.error("Demo-request notify email failed", notifyResult.error);
  }
  if (autoReplyResult.error) {
    console.error("Demo-request auto-reply email failed", autoReplyResult.error);
  }
}
