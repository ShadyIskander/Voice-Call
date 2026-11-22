import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";

export async function POST(req) {
  const session = await auth();
  if (!session?.user || session.error) {
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  }

  // Each signed-in person has their own Google token, so events always go
  // to THEIR calendar. The token is read server-side only.
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

  // 1. Turn the sentence into structured event data (Gemini free tier)
  const prompt = `Current local date and time: ${now} (timezone ${tz}).
Extract ONE calendar event from the text below. Resolve relative dates like "tomorrow" or "next Friday".
Return JSON: {"title": string, "start": "YYYY-MM-DDTHH:mm:ss", "end": "YYYY-MM-DDTHH:mm:ss", "location": string, "description": string}.
Times are local, with no timezone offset. If no end time is given, make it 1 hour after start. Use "" for unknown location/description.

Text: """${text}"""`;

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const g = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );
  if (!g.ok) return Response.json({ error: "Couldn't understand that (AI error)." }, { status: 502 });

  let ev;
  try {
    const gj = await g.json();
    ev = JSON.parse(gj.candidates[0].content.parts[0].text);
    if (!ev.title || !ev.start || !ev.end) throw new Error("incomplete");
    if (isNaN(new Date(ev.start)) || isNaN(new Date(ev.end))) throw new Error("bad date");
    if (new Date(ev.end) <= new Date(ev.start)) {
      // fall back to 1 hour after start
      const e = new Date(new Date(ev.start).getTime() + 3600000);
      const pad = (n) => String(n).padStart(2, "0");
      ev.end = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T${pad(e.getHours())}:${pad(e.getMinutes())}:00`;
    }
  } catch {
    return Response.json({ error: "Couldn't find an event in that. Try adding a day and time." }, { status: 422 });
  }

  // 2. Create it in the signed-in person's Google Calendar
  const c = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
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
