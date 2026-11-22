import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

async function refresh(token) {
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID,
        client_secret: process.env.AUTH_GOOGLE_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw d;
    return {
      ...token,
      access_token: d.access_token,
      expires_at: Math.floor(Date.now() / 1000) + d.expires_in,
      refresh_token: d.refresh_token ?? token.refresh_token,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshFailed" };
  }
}

// ALLOWED_EMAILS = comma-separated list, e.g. "me@gmail.com,friend@gmail.com"
// If it is empty or missing, NOBODY can sign in (fails closed).
function allowedList() {
  return (process.env.ALLOWED_EMAILS || process.env.ALLOWED_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      return Boolean(email && profile?.email_verified && allowedList().includes(email));
    },
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
        };
      }
      if (Date.now() < (token.expires_at ?? 0) * 1000 - 60000) return token;
      return refresh(token);
    },
    session({ session, token }) {
      // Do NOT put the access token here: the session is sent to the browser.
      // /api/add reads the token server-side with getToken instead.
      session.error = token.error;
      return session;
    },
  },
});
