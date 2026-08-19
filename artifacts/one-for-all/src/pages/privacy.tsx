import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

/**
 * The privacy policy.
 *
 * Every factual claim here was checked against the code rather than written
 * from intention: recordings really are held in memory only (multer memory
 * storage, no filesystem writes, no audio column anywhere in the schema), and
 * the event log really does stay in the browser tab. If any of that changes,
 * this page has to change in the same commit — a policy that describes an
 * older version of the app is worse than none.
 *
 * The controller name, contact address and date came from Anton directly —
 * they are the only parts that cannot be derived from the code. If the
 * controlling entity ever changes, this is the page that has to change with it.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-5 pt-12 max-w-2xl mx-auto w-full">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground mb-6 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Privacy</h1>
        <p className="text-muted-foreground text-sm">
          What this app stores, who can see it, and how to get rid of it.
        </p>
      </header>

      <Section title="The short version">
        <p>
          This is a private diary. Nothing you write is public, nothing is shared with
          other users, nothing is sold, and there are no adverts or trackers. Your
          recordings are never kept. You can export everything or delete everything,
          at any time, from Settings.
        </p>
      </Section>

      <Section title="Who is responsible">
        <p>
          The data controller is <strong>AKT Education</strong>,
          contactable at <strong>anton.k.toshev@gmail.com</strong>. If you want a copy of
          your data, a correction, or deletion, that address reaches a person.
        </p>
      </Section>

      <Section title="What is stored">
        <p>
          <strong>Your account:</strong> your name, your email address, and either a
          hashed password or a link to your Google account. Passwords are stored only
          as hashes and cannot be read back.
        </p>
        <p>
          <strong>What you write:</strong> your entries, the original text of each
          capture, and the profiles you create under People.
        </p>
        <p>
          <strong>What is not stored:</strong> your voice. A recording is held in
          memory only for as long as it takes to turn it into text, then discarded. It
          is never written to disk and never saved in the database.
        </p>
      </Section>

      <Section title="Who else processes it">
        <p>
          <strong>OpenAI</strong> receives your recordings to transcribe them into
          text. <strong>Anthropic</strong> receives the text of a capture to sort it
          into categories and split it into separate entries. Both are used only at
          the moment you make a capture.
        </p>
        <p>
          <strong>Google</strong> is involved only if you choose to sign in with it,
          and then only to confirm who you are.
        </p>
        <p>
          <strong>Replit</strong> hosts the app and the database.
        </p>
        <p>
          These providers are in the United States. If you would rather no AI provider
          saw your writing at all, you can still use the app — captures save without
          it, they are simply not sorted for you.
        </p>
      </Section>

      <Section title="Writing about other people">
        <p>
          When you record something about a friend or colleague, you are writing down
          personal information about someone who has not agreed to it. That is normal
          for a diary, and the app is built so it stays that way: People profiles are
          private to you, are never shared or made public, and nothing is ever looked
          up about anyone from the internet.
        </p>
        <p>
          The app will suggest a detail it noticed, but it never saves one about a
          person without you confirming it. Deleting a person shows you exactly what
          is held about them first, and the entries you wrote stay yours.
        </p>
        <p>
          If someone asks you to remove what you have recorded about them, you can do
          it yourself from their profile.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can see everything held about you by exporting it from Settings — it
          comes out as a plain JSON file, not a summary. You can correct anything by
          editing it. You can delete your entries with "Clear all my data", or close
          the account entirely with "Delete my account", which erases the account and
          everything in it and cannot be reversed.
        </p>
        <p>
          If you are in the UK or EU, you also have the right to complain to your
          national data protection authority.
        </p>
      </Section>

      <Section title="How long things are kept">
        <p>
          Your entries stay until you delete them or close your account. Recordings
          are never kept at all. Server logs record that a request happened and
          whether it failed, never what you wrote.
        </p>
      </Section>

      <Section title="Analytics">
        <p>
          There are none. The app counts a few actions to help find bugs, but those
          counts live in your browser tab and are gone when you close it. Nothing is
          sent anywhere, and there is no third-party analytics or advertising code.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If what the app does with your data changes, this page changes with it.
          Last updated <strong>19 August 2026</strong>.
        </p>
      </Section>
    </div>
  );
}
