import { auth, signIn, signOut } from "@/auth";
import Recorder from "./Recorder";

export default async function Home() {
  const session = await auth();

  if (!session || session.error) {
    return (
      <main>
        <h1>Say it. It's on your calendar.</h1>
        <p className="sub">Sign in with Google to let this app add events to your own calendar. Access is limited to approved accounts.</p>
        <form action={async () => { "use server"; await signIn("google"); }}>
          <button className="primary">Sign in with Google</button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>What's coming up?</h1>
      <p className="sub">Signed in as {session.user?.email}</p>
      <Recorder />
      <form action={async () => { "use server"; await signOut(); }}>
        <button className="link">Sign out</button>
      </form>
    </main>
  );
}
