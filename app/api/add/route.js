import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";
import * as chrono from "chrono-node";

const pad = (n) => String(n).padStart(2, "0");

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

// ---------- 1. No-AI parsing (free, instant, English) ----------
function parseLocally(text, now) {
  const results = chrono.parse(text, refFromClient(now), { forwardDate: true });
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

// ---------- 2. AI fallback (only when the no-AI parser finds no date) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askGemini(text, tz, now) {
  const prompt = `Current local date and time: ${now} (timezone ${tz}).
Extract ONE calendar event from the text below. Resolve relative dates like "tomorrow" or "next Friday".
Return JSON: {"title": string, "start": "YYYY-MM-DDTHH:mm:ss", "end": "YYYY-MM-DDTHH:mm:ss", "location": string, "description": string}.
Times are local, with no timezone offset. If no end time is given, make it 1 hour after start. Use "" for unknown location/description.

Text: """${text}"""`;

  const models = [
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    process.env.GEMINI_FALLBACK_MODEL || "gemini-3.6-flash",
  ];
  let lastErr = "AI unavailable";
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const g = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        }
      );
      if (g.ok) {
        const gj = await g.json();
        return JSON.parse(gj.candidates[0].content.parts[0].text);
      }
      let detail = "";
      try { detail = (await g.json())?.error?.message || ""; } catch {}
      lastErr = `AI error (${g.status}): ${detail.slice(0, 160)}`;
      if (g.status !== 503 && g.status !== 429) break; // only retry busy errors
      await sleep(800);
    }
  }
  throw new Error(lastErr);
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
  const accessToken = jwt?.access_token;
  if (!accessToken || jwt?.error) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { text, tz, now } = await req.json();
  if (!text?.trim()) return Response.json({ error: "Say or type something first." }, { status: 400 });
  if (text.length > 500) return Response.json({ error: "That's too long. Keep it to one event." }, { status: 400 });

  let ev = null;
  try {
    ev = parseLocally(text, now);
  } catch {
    ev = null;
  }

  if (!ev) {
    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        { error: "Couldn't find a day or time. Try: \"Dentist next Tuesday at 3pm\"." },
        { status: 422 }
      );
    }
    try {
      ev = await askGemini(text, tz, now);
      if (!ev.title || !ev.start || !ev.end) throw new Error("Couldn't find an event in that.");
      if (isNaN(new Date(ev.start)) || isNaN(new Date(ev.end))) throw new Error("Couldn't read that date.");
      if (new Date(ev.end) <= new Date(ev.start)) {
        const e = new Date(new Date(ev.start).getTime() + 3600000);
        ev.end = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T${pad(e.getHours())}:${pad(e.getMinutes())}:00`;
      }
    } catch (err) {
      return Response.json({ error: err.message || "Couldn't understand that." }, { status: 502 });
    }
  }

  const c = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: ev.title,
      location: ev.location || undefined,
      description: ev.description || undefined,
      start: { dateTime: ev.start, timeZone: tz },
      end: { dateTime: ev.end, timeZone: tz },
    }),
  });
  if (!c.ok) return Response.json({ error: "Google Calendar rejected the event." }, { status: 502 });

  const created = await c.json();
  return Response.json({ title: ev.title, start: ev.start, end: ev.end, link: created.htmlLink });
}
