import { Resend } from "resend";
import type { DemoRequestInput } from "@/lib/demo-request";

/** Extra inhoud wanneer er automatisch een trial-licentie werd uitgegeven. */
export type DemoRequestEmailExtras = {
  licenseKey?: string;
  portalUrl?: string;
  /** True als een bestaande demo-licentie opnieuw werd gekoppeld i.p.v. nieuwe aanmaak. */
  licenseReused?: boolean;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linesForNotify(data: DemoRequestInput, extras?: DemoRequestEmailExtras): string {
  const phone = data.phone?.trim() || "—";
  const message = data.message?.trim() || "—";
  const lines = [
    `Naam: ${data.name}`,
    `E-mail: ${data.email}`,
    `Club/organisatie: ${data.club}`,
    `Telefoon: ${phone}`,
    "",
    "Bericht:",
    message,
  ];
  if (extras?.licenseKey?.trim()) {
    lines.push("", "Automatisch uitgegeven demo-licentie:", extras.licenseKey.trim());
    if (extras.licenseReused) {
      lines.push("(bestaande demo-licentie voor dit e-mailadres hergebruikt)");
    }
    if (extras.portalUrl?.trim()) {
      lines.push("Klantportaal:", extras.portalUrl.trim());
    }
  }
  return lines.join("\n");
}

function notifyHtml(data: DemoRequestInput, extras?: DemoRequestEmailExtras): string {
  const phone = escapeHtml(data.phone?.trim() || "—");
  const message = escapeHtml(data.message?.trim() || "—").replace(/\r\n|\n/g, "<br/>");
  const licBlock =
    extras?.licenseKey?.trim() ?
      `<p style="margin-top:18px;padding:12px 14px;background:#f6f8fa;border-radius:8px;font-family:ui-monospace,monospace;font-size:13px;">
        Demo-licentie: <strong>${escapeHtml(extras.licenseKey.trim())}</strong>
        ${extras.licenseReused ? `<br/><span style="color:#666;font-size:12px;">(bestaande demo voor dit adres)</span>` : ""}
        ${extras.portalUrl?.trim() ? `<br/>Portaal: <a href="${escapeHtml(extras.portalUrl.trim())}">${escapeHtml(extras.portalUrl.trim())}</a>` : ""}
      </p>`
    : "";
  return `
    <p>Er is een nieuwe demo-aanvraag via de website.</p>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Naam</td><td>${escapeHtml(data.name)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">E-mail</td><td>${escapeHtml(data.email)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Club</td><td>${escapeHtml(data.club)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#555;">Telefoon</td><td>${phone}</td></tr>
    </table>
    ${licBlock}
    <p style="margin-top:16px;color:#555;">Bericht</p>
    <p style="margin:0;">${message}</p>
  `.trim();
}

function autoReplyHtml(name: string, extras?: DemoRequestEmailExtras): string {
  const first = escapeHtml(name.split(/\s+/)[0] || name);
  const key = extras?.licenseKey?.trim();
  const portal = extras?.portalUrl?.trim();
  const licSection =
    key ?
      `
    <p style="margin-top:20px;padding:14px 16px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.25);border-radius:10px;">
      <strong>Je tijdelijke demo-licentie</strong><br/><br/>
      Sleutel (kopieer in ArenaCue):<br/>
      <span style="font-family:ui-monospace,monospace;font-size:15px;letter-spacing:0.04em;">${escapeHtml(key)}</span>
      ${extras?.licenseReused ? `<br/><span style="font-size:12px;color:#555;">Dit is je bestaande demo-profiel voor dit e-mailadres.</span>` : ""}
      ${portal ? `<br/><br/><a href="${escapeHtml(portal)}">Licentiestatus & download</a> — vul je sleutel en dit e-mailadres in.` : ""}
    </p>
    <p>Je kunt ArenaCue meteen installeren en activeren; we plannen daarnaast nog graag een persoonlijke demo met je in.</p>
  `
    : `
    <p>We nemen zo snel mogelijk contact met je op om een demo in te plannen.</p>
  `;
  return `
    <p>Hallo ${first},</p>
    <p>Bedankt voor je interesse in <strong>ArenaCue</strong>. We hebben je demo-aanvraag goed ontvangen.</p>
    ${licSection}
    <p style="margin-top:24px;color:#666;font-size:13px;">Met vriendelijke groet,<br/>Het ArenaCue-team</p>
  `.trim();
}

function autoReplyText(name: string, extras?: DemoRequestEmailExtras): string {
  const first = name.split(/\s+/)[0] || name;
  const key = extras?.licenseKey?.trim();
  const portal = extras?.portalUrl?.trim();
  const lines = [
    `Hallo ${first},`,
    "",
    "Bedankt voor je interesse in ArenaCue. We hebben je demo-aanvraag goed ontvangen.",
    "",
  ];
  if (key) {
    lines.push("Je tijdelijke demo-licentiesleutel:", key);
    if (extras?.licenseReused) {
      lines.push("(bestaande demo voor dit e-mailadres)");
    }
    if (portal) {
      lines.push(`Licentiestatus & download: ${portal}`);
    }
    lines.push("", "Installeer ArenaCue op Windows en plak deze sleutel bij activatie.", "");
  }
  lines.push(
    key ?
      "We plannen daarnaast nog graag een persoonlijke demo met je in." :
      "We nemen zo snel mogelijk contact met je op om een demo in te plannen.",
    "",
    "Met vriendelijke groet,",
    "Het ArenaCue-team",
  );
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Verstuurt (1) een notificatie naar het team en (2) een bevestiging naar de aanvrager.
 * Faalt stil als RESEND_API_KEY ontbreekt; logt errors bij mislukte verzending.
 */
export async function sendDemoRequestEmails(
  data: DemoRequestInput,
  extras?: DemoRequestEmailExtras,
): Promise<void> {
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
      text: linesForNotify(data, extras),
      html: notifyHtml(data, extras),
    }),
    resend.emails.send({
      from,
      to: [data.email],
      replyTo: notifyTo,
      subject: extras?.licenseKey?.trim() ?
        "Je ArenaCue demo-licentie"
      : "Je demo-aanvraag bij ArenaCue",
      text: autoReplyText(data.name, extras),
      html: autoReplyHtml(data.name, extras),
    }),
  ]);

  if (notifyResult.error) {
    console.error("Demo-request notify email failed", notifyResult.error);
  }
  if (autoReplyResult.error) {
    console.error("Demo-request auto-reply failed", autoReplyResult.error);
  }
}
