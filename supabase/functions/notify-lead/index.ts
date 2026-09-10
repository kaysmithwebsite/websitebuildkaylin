// Supabase Edge Function: notify-lead
//
// Emails Kaylin whenever a lead lands. Invoked either by the after-insert
// trigger in schema.sql or by a Database Webhook configured in the dashboard.
//
// Deploy:
//   supabase functions deploy notify-lead
//   supabase secrets set RESEND_API_KEY=re_xxx \
//     NOTIFY_TO=info@kaylinsmith.com \
//     NOTIFY_FROM="Kaylin Smith Website <website@yourdomain.com>"
//
// The sending domain must be verified with the email provider first, otherwise
// delivery fails or lands in spam. Until RESEND_API_KEY is set this function
// returns 200 with {sent:false}, so a missing key never fails the insert.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO            = Deno.env.get("NOTIFY_TO") ?? "";
const NOTIFY_TO_REAL_ESTATE = Deno.env.get("NOTIFY_TO_REAL_ESTATE") ?? NOTIFY_TO;
const NOTIFY_TO_CONSULTING  = Deno.env.get("NOTIFY_TO_CONSULTING") ?? NOTIFY_TO;

/**
 * The two practices are deliberately separate: a consulting enquiry must never
 * land in the real estate inbox.
 *
 * Real estate is the EXPLICIT list and consulting is the default, which is the
 * safe direction. A form added later without a routing rule lands in the
 * general inbox rather than silently joining the real estate pipeline.
 *
 * crm_inquiries carries both practices in one table, so it is routed on the
 * path the visitor chose rather than on the table. Before this it matched no
 * rule at all and fell through to real estate, mixing the two.
 */
const REAL_ESTATE_TABLES = new Set([
  "leads", "showing_requests", "valuation_requests", "referral_requests",
  "guide_downloads", "newsletter_subscribers", "listing_alerts",
]);
const REAL_ESTATE_PATHS = new Set(["buy", "sell", "invest"]);

function inboxFor(table: string, record: Record<string, unknown>): string {
  if (table === "crm_inquiries") {
    const path = String(record.path ?? "");
    return REAL_ESTATE_PATHS.has(path) ? NOTIFY_TO_REAL_ESTATE : NOTIFY_TO_CONSULTING;
  }
  return REAL_ESTATE_TABLES.has(table) ? NOTIFY_TO_REAL_ESTATE : NOTIFY_TO_CONSULTING;
}

/** Shown in the notification so the inbox it arrived in is never a guess. */
function practiceFor(table: string, record: Record<string, unknown>): string {
  return inboxFor(table, record) === NOTIFY_TO_REAL_ESTATE ? "Real Estate" : "Consulting";
}
const NOTIFY_FROM    = Deno.env.get("NOTIFY_FROM") ?? "";
const SITE           = Deno.env.get("SITE_URL") ?? "https://kaylinsmith.com";

const LABELS: Record<string, string> = {
  leads: "General enquiry",
  showing_requests: "Private showing request",
  valuation_requests: "Home evaluation request",
  consultation_requests: "Consultation request",
  referral_requests: "Trusted professional referral request",
  business_enquiries: "Business and events consulting enquiry",
  newsletter_subscribers: "Newsletter subscription",
  listing_alerts: "Listing alert signup",
  guide_downloads: "Guide download",
  crm_inquiries: "Website enquiry",
};

/** The progressive form says what it is about, so the subject line can too. */
const PATH_LABELS: Record<string, string> = {
  buy: "Buyer enquiry",
  sell: "Seller enquiry",
  invest: "Investor enquiry",
  consulting: "Business consulting enquiry",
  other: "General enquiry",
};

// Urgent things go first in the subject line so the phone notification is useful.
const PRIORITY = new Set([
  "showing_requests", "valuation_requests", "consultation_requests",
  "referral_requests", "business_enquiries",
]);

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fieldRows(record: Record<string, unknown>): string {
  const skip = new Set(["id", "created_at", "status", "context"]);
  const rows: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (skip.has(k) || v === null || v === "" ||
        (Array.isArray(v) && v.length === 0)) continue;
    const label = k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    const value = Array.isArray(v) ? v.join(", ") : String(v);
    rows.push(
      `<tr>
         <td style="padding:9px 16px 9px 0;color:#4A5A6E;font-size:13px;vertical-align:top;
                    border-bottom:1px solid #E9EBED;white-space:nowrap">${esc(label)}</td>
         <td style="padding:9px 0;color:#07182D;font-size:14px;vertical-align:top;
                    border-bottom:1px solid #E9EBED">${esc(value)}</td>
       </tr>`);
  }
  return rows.join("");
}

function contextRows(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "";
  const bits: string[] = [];
  if (ctx.source)    bits.push(`Source: ${esc(ctx.source)}`);
  if (ctx.page_path) bits.push(`Page: ${esc(ctx.page_path)}`);
  if (ctx.referrer)  bits.push(`Referrer: ${esc(ctx.referrer)}`);
  const utm = ctx.utm as Record<string, string> | undefined;
  if (utm && Object.keys(utm).length) {
    bits.push("Campaign: " + Object.entries(utm).map(([k, v]) => `${k}=${esc(v)}`).join(" "));
  }
  if (!bits.length) return "";
  return `<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid #E9EBED;
                    color:#7C8896;font-size:12px;line-height:1.7">${bits.join("<br>")}</p>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { table?: string; record?: Record<string, unknown>; type?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }

  const table  = body.table ?? "leads";
  const record = body.record ?? {};
  const label  = table === "crm_inquiries"
    ? (PATH_LABELS[String(record.path ?? "")] ?? "Website enquiry")
    : (LABELS[table] ?? "Website enquiry");

  const to = inboxFor(table, record);
  if (!RESEND_API_KEY || !to || !NOTIFY_FROM) {
    // Configuration missing. Report it honestly rather than pretending to send.
    console.warn("notify-lead: RESEND_API_KEY, destination inbox or NOTIFY_FROM not set");
    return new Response(
      JSON.stringify({ sent: false, reason: "email not configured" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const who     = (record.name as string) || (record.email as string) || "Someone";
  const subject = `${PRIORITY.has(table) ? "[Action] " : ""}[${practiceFor(table, record)}] ${label}: ${who}`;

  const html = `
<div style="background:#F7F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,
            'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E9EBED">
    <div style="background:#07182D;padding:22px 28px">
      <div style="color:#fff;font-size:13px;font-weight:600;letter-spacing:.18em;
                  text-transform:uppercase">Kaylin Smith</div>
      <div style="color:#A8B4C4;font-size:10px;letter-spacing:.18em;text-transform:uppercase;
                  margin-top:4px">Website enquiry</div>
    </div>
    <div style="padding:28px">
      <h1 style="margin:0 0 4px;font-size:21px;color:#07182D;font-weight:600">${esc(label)}</h1>
      <p style="margin:0 0 22px;color:#7C8896;font-size:13px">
        Received ${esc(new Date(String(record.created_at ?? Date.now())).toLocaleString("en-CA", { timeZone: "America/Toronto" }))} Toronto time
      </p>
      <table style="width:100%;border-collapse:collapse">${fieldRows(record)}</table>
      ${contextRows(record.context as Record<string, unknown> | null)}
      ${record.email
        ? `<p style="margin:26px 0 0">
             <a href="mailto:${esc(record.email)}"
                style="display:inline-block;background:#07182D;color:#fff;text-decoration:none;
                       padding:13px 22px;font-size:14px">Reply to ${esc(who)}</a></p>`
        : ""}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #E9EBED;color:#7C8896;font-size:11px">
      Sent automatically by ${esc(SITE)} to ${esc(to)}. The full record is in the
      <code>${esc(table)}</code> table.
    </div>
  </div>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [to],
      reply_to: (record.email as string) || undefined,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("notify-lead: send failed", res.status, detail);
    // 200 so the trigger never retries in a loop; the failure is logged.
    return new Response(JSON.stringify({ sent: false, status: res.status, detail }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ sent: true }),
    { status: 200, headers: { "Content-Type": "application/json" } });
});
