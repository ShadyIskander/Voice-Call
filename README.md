# Voice Calendar

Speak or type an event → Gemini parses it → it's created in Google Calendar → syncs to your iPhone.

## Local run
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. `npm run dev` → http://localhost:3000

## Google Cloud setup
- Enable the Google Calendar API.
- OAuth client (Web application). Authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google`
  - `https://YOUR-APP.vercel.app/api/auth/callback/google`
- OAuth consent screen: set publishing status to "In production" so sign-in doesn't expire every 7 days (you'll see an "unverified app" warning; click Advanced → continue).

## Multiple people
- Put every person's Google email in `ALLOWED_EMAILS` (comma-separated). Empty = nobody can sign in.
- Each person signs in with their own Google account, and events go to their own calendar.
- While the Google consent screen is in "Testing", also add each person under Audience → Test users (max 100). Or set it to "In production" (see above).
- After changing `ALLOWED_EMAILS` on Vercel, redeploy.

## Deploy
Push to GitHub → import in Vercel → add all env vars from `.env.example` → deploy → add the Vercel URL's callback to Google's redirect URIs.

## iPhone
Settings → Calendar → Accounts → Add Account → Google. Safari → Share → Add to Home Screen.
