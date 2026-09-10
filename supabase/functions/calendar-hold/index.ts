// Supabase Edge Function: calendar-hold
//
// Creates a Google Calendar event for a real estate consultation.
//
// READ THIS FIRST. If Kaylin books through Calendly or Cal.com, she does NOT
// need this function. Those tools write to Google Calendar natively, handle
// timezones, reschedules, cancellations and reminders, and cannot double-book
// her. Set booking.real_estate_url in data/site.json and stop here. This
// function exists for the case where a form submission should place a
// provisional hold in the calendar before any human has confirmed anything.
//
// What it creates is a HOLD, not a confirmed appointment: the event is marked
// tentative and transparent, so it never blocks the slot for a real booking.
// A form submission is a request, and treating it as a confirmed meeting is how
// calendars end up full of appointments nobody agreed to.
//
// Deploy:
//   supabase functions deploy calendar-hold
//   supabase secrets set \
//     GOOGLE_SA_EMAIL="calendar-bot@project.iam.gserviceaccount.com" \
//     GOOGLE_SA_KEY="$(cat key.pem)" \
//     GOOGLE_CALENDAR_ID="info@kaylinsmith.com" \
//     GOOGLE_IMPERSONATE="info@kaylinsmith.com"
//
// The service account needs domain-wide delegation for
// https://www.googleapis.com/auth/calendar.events, granted in Google Workspace
// admin. A personal gmail.com account cannot use delegation; there, share the
// calendar with the service account address and give it "Make changes to events".

const SA_EMAIL     = Deno.env.get("GOOGLE_SA_EMAIL") ?? "";
const SA_KEY       = Deno.env.get("GOOGLE_SA_KEY") ?? "";
const CALENDAR_ID  = Deno.env.get("GOOGLE_CALENDAR_ID") ?? "";
const IMPERSONATE  = Deno.env.get("GOOGLE_IMPERSONATE") ?? "";
const TZ           = Deno.env.get("CALENDAR_TZ") ?? "America/Toronto";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "")
                  .replace(/-----END [^-]+-----/, "")
                  .replace(/\s+/g, "");
  const raw = atob(body);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Signs a JWT and exchanges it for an access token. */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims: Record<string, unknown> = {
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (IMPERSONATE) claims.sub = IMPERSONATE;

  const enc = new TextEncoder();
  const unsigned = `${b64url(enc.encode(JSON.stringify(header)))}.` +
                   `${b64url(enc.encode(JSON.stringify(claims)))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(SA_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned)));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: { record?: Record<string, unknown>; start?: string; minutes?: number };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 }); }

  if (!SA_EMAIL || !SA_KEY || !CALENDAR_ID) {
    // Not configured. Say so rather than failing silently or pretending.
    return new Response(
      JSON.stringify({ created: false, reason: "google calendar not configured" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const r = body.record ?? {};
  const minutes = body.minutes ?? 30;
  const start = body.start ? new Date(body.start) : new Date(Date.now() + 24 * 3600 * 1000);
  const end = new Date(start.getTime() + minutes * 60000);
  const who = (r.name as string) || (r.email as string) || "Website enquiry";

  const details = Object.entries(r)
    .filter(([k, v]) => !["id", "created_at", "status", "context"].includes(k) && v)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("\n");

  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `Real estate consultation request: ${who}`,
          description: `${details}\n\nPlaced automatically from kaylinsmith.com. This is a ` +
                       `provisional hold, not a confirmed appointment. Confirm with the client ` +
                       `and change the status once agreed.`,
          start: { dateTime: start.toISOString(), timeZone: TZ },
          end:   { dateTime: end.toISOString(),   timeZone: TZ },
          status: "tentative",
          transparency: "transparent",   // never blocks the slot
          reminders: { useDefault: true },
          ...(r.email ? { attendees: [{ email: r.email as string, optional: true }] } : {}),
        }),
      });
    if (!res.ok) {
      const detail = await res.text();
      console.error("calendar-hold: create failed", res.status, detail);
      return new Response(JSON.stringify({ created: false, status: res.status, detail }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const ev = await res.json();
    return new Response(JSON.stringify({ created: true, id: ev.id, link: ev.htmlLink }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("calendar-hold:", err);
    return new Response(JSON.stringify({ created: false, error: String(err) }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
});
