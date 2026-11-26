import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";
import * as chrono from "chrono-node";

const pad = (n) => String(n).padStart(2, "0");

// Google Calendar event colors: "1" to "11". Anything else = calendar default.
const VALID_COLORS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

// The browser sends "2026-11-23T14:05 (Monday)": the user's own local clock.
function refFromClient(now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(now || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date();
}

// Wall-clock string from parsed components, plus optional minutes.
function wall(c, addMinutes = 0) {
  const d = new Date(
    Date.UTC(c.get("year"), c.get("month") - 1, c.get("day"), c.get("hour"), c.get("minute") + addMinutes)
  );
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

// "next Tuesday" -> the nearest upcoming Tuesday (not the one a week later).
// If today IS that weekday, keep "next" so it means one week from today.
const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function simplifyNext(text, ref) {
  return text.replace(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/gi,
    (m, d) => (DAY_INDEX[d.slice(0, 3).toLowerCase()] === ref.getDay() ? m : m.replace(/^next\s+/i, ""))
  );
}

// ---------- Date/time parsing (no AI, free, instant, English) ----------
function parseLocally(input, now) {
  const ref = refFromClient(now);
  const text = simplifyNext(input, ref);
  const results = chrono.parse(text, ref, { forwardDate: true });
  if (!results.length) return null;
  const r = results[0];

  // No time said (e.g. "dentist tomorrow") -> default to 9:00 AM
  if (!r.start.isCertain("hour")) {
    r.start.assign("hour", 9);
    r.start.assign("minute", 0);
  }

  let rest = text.slice(0, r.index) + " " + text.slice(r.index + r.text.length);

  // "for 2 hours", "for 30 minutes", "for an hour"
  let minutes = null;
  rest = rest.replace(/\bfor\s+(an?|\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i, (_, n, unit) => {
    const num = /^an?$/i.test(n) ? 1 : parseFloat(n);
    minutes = /^h/i.test(unit) ? Math.round(num * 60) : Math.round(num);
    return " ";
  });

  const start = wall(r.start);
  let end;
  if (r.end && r.end.isCertain("hour")) end = wall(r.end);
  else end = wall(r.start, minutes || 60);

  let title = rest
    .replace(/^\s*(please\s+)?(remind me (to|about)|schedule( an?| the)?)\s+/i, "")
    .replace(/[,.;:!?]+/g, " ");
  for (let i = 0; i < 4; i++) {
    title = title.replace(/\s+(at|on|in|for|by|from|to|until|the|a|an|next|this)\s*$/i, "");
  }
  title = title.replace(/\s+/g, " ").trim();
  if (!title) title = "Event";
  title = title[0].toUpperCase() + title.slice(1);

  return { title, start, end, location: "", description: "" };
}

// Open /api/add in a browser: if you see "no-ai", the new version is live.
export async function GET() {
  return Response.json({ version: "no-ai" });
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user || session.error) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }

  const secure = req.nextUrl?.protocol === "https:" || process.env.NODE_ENV === "production";
  const jwt = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: secure,
    salt: secure ? "__Secure-authjs.session-token" : "authjs.session-token",
  });
  let accessToken = jwt?.access_token;
  if (!jwt || jwt.error || !accessToken) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }

  // The token in the cookie only lasts about an hour, so renew it when needed.
  if (Date.now() >= (jwt.expires_at ?? 0) * 1000 - 60000) {
    if (!jwt.refresh_token) {
      return Response.json({ error: "Please sign out and sign in again." }, { status: 401 });
    }
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID,
        client_secret: process.env.AUTH_GOOGLE_SECRET,
        grant_type: "refresh_token",
        refresh_token: jwt.refresh_token,
      }),
    });
    if (!r.ok) {
      return Response.json({ error: "Session expired. Please sign out and sign in again." }, { status: 401 });
    }
    accessToken = (await r.json()).access_token;
  }

  const { text, tz, now, colorId } = await req.json();
  if (!text?.trim()) return Response.json({ error: "Say or type something first." }, { status: 400 });
  if (text.length > 500) return Response.json({ error: "That's too long. Keep it to one event." }, { status: 400 });

  // Empty / invalid -> undefined, so Google uses the calendar's default color.
  const color = VALID_COLORS.includes(String(colorId)) ? String(colorId) : undefined;

  let ev = null;
  try {
    ev = parseLocally(text, now);
  } catch {
    ev = null;
  }

  if (!ev) {
    return Response.json(
      { error: "Couldn't find a day or time. Try: \"Dentist next Tuesday at 3pm\"." },
      { status: 422 }
    );
  }

  const c = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.title,
      location: ev.location || undefined,
      description: ev.description || undefined,
      colorId: color,
      start: { dateTime: ev.start, timeZone: tz },
      end: { dateTime: ev.end, timeZone: tz },
    }),
  });
  if (!c.ok) {
    let detail = "";
    try {
      detail = (await c.json())?.error?.message || "";
    } catch {}
    console.error("Calendar error", c.status, detail);
    return Response.json(
      { error: `Google Calendar error (${c.status}): ${detail.slice(0, 200) || "no details"}` },
      { status: 502 }
    );
  }

  const created = await c.json();
  return Response.json({ title: ev.title, start: ev.start, end: ev.end, link: created.htmlLink });
}
