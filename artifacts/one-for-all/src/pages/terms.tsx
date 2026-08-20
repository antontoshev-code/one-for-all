import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

/**
 * Terms of service.
 *
 * Written to be read, not scrolled past. Every clause here is one this app
 * actually needs — there is no arbitration clause, no class-action waiver and
 * no licence grant over the user's writing, because none of those are true of
 * what this service does, and including them by habit would be dishonest.
 *
 * Two things it says plainly that most terms bury: the writing belongs to the
 * person who wrote it, and the AI gets things wrong. Both are load-bearing for
 * a diary app.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Terms() {
  return (
    <div className="flex flex-col min-h-[100dvh] pb-24 px-5 pt-12 max-w-2xl mx-auto w-full">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground mb-6 hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Settings
      </Link>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Terms</h1>
        <p className="text-muted-foreground text-sm">
          The agreement between you and whoever runs this app. Short, and meant to be read.
        </p>
      </header>

      <Section title="Who you are agreeing with">
        <p>
          One for All is run by <strong>AKT Education</strong>, reachable at{" "}
          <strong>anton.k.toshev@gmail.com</strong>. Using the app means accepting what is
          on this page. If you do not accept it, do not use the app — and if you have
          already started, Settings has a one-click way out.
        </p>
      </Section>

      <Section title="What this is">
        <p>
          A private place to capture thoughts by voice or text, which the app then helps
          you sort. It is not a medical service, a legal service, a therapist, or a record
          of legal standing. Do not keep something here as its only copy if you cannot
          afford to lose it — export regularly if it matters.
        </p>
      </Section>

      <Section title="Your writing stays yours">
        <p>
          You own what you write. Using the app grants no ownership over it and no licence
          to publish it, sell it, or train anything on it. The only permission taken is the
          narrow technical one needed to run the service for you: storing your entries so
          you can read them back, and sending a capture to the providers named in the{" "}
          <Link href="/privacy" className="text-primary hover:underline">privacy policy</Link>{" "}
          at the moment you make it.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          An account is for one person. Keep your password to yourself — anyone who has it
          can read everything you have written. Tell us promptly if you think someone else
          has got into your account.
        </p>
        <p>
          You must be at least 16, or old enough to consent to data processing where you
          live, whichever is higher.
        </p>
      </Section>

      <Section title="Writing about other people">
        <p>
          A diary naturally contains other people, and this app has a feature built around
          that. What you record about someone else is your responsibility, and the law
          where you live may give them rights over it — to see it, or to have it removed.
        </p>
        <p>
          So keep it to your own recollections, do not use the app to build files on
          people, and if someone asks you to remove what you have written about them, do
          it. Their profile can be deleted from inside the app, and you are shown exactly
          what is held before you confirm.
        </p>
      </Section>

      <Section title="What you cannot use it for">
        <p>
          Anything illegal. Harassing, tracking or profiling other people. Trying to reach
          another user's data. Automated abuse of the AI features, or working around the
          usage limits. Reselling access.
        </p>
        <p>
          Accounts doing any of that can be suspended or closed. Where it is practical to
          warn you first, we will.
        </p>
      </Section>

      <Section title="The AI gets things wrong">
        <p>
          Transcription mishears words. Categorisation misfiles things. Name detection
          suggests people who are not there and misses people who are. This is normal
          rather than a malfunction, and it is why nothing is saved about a person without
          you confirming it, and why every suggestion can be changed.
        </p>
        <p>
          Check anything that matters before relying on it. The app offers suggestions
          about your own words; it is not a source of truth about them.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          The app is early and free. It may be unavailable, lose features, or change
          without notice, and no uptime is promised. If it is ever going to shut down, you
          will get reasonable notice and time to export — your entries will not simply
          disappear one morning.
        </p>
      </Section>

      <Section title="Ending it">
        <p>
          You can stop at any time. Settings → <em>Delete my account</em> erases the
          account and everything in it, immediately and permanently. No notice period, no
          email exchange, no reason required.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          The app is provided as it is, without warranty, and so far as the law allows AKT
          Education is not liable for lost entries, missed tasks, or decisions made on the
          basis of something the app got wrong.
        </p>
        <p>
          Some things cannot be excluded by law and are not excluded here — including
          liability for death or personal injury caused by negligence, for fraud, and for
          anything else a consumer cannot be asked to sign away. Nothing on this page
          affects your statutory rights.
        </p>
      </Section>

      <Section title="Which law applies">
        <p>
          Bulgarian law, and the courts of Bulgaria. If you use the app as a consumer
          elsewhere in the EU or the UK, you keep the protections of your own country's law
          and can bring a claim there.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          These terms may change as the app does. Anything significant will be flagged in
          the app rather than quietly swapped in, and continuing to use it after a change
          means accepting the new version. Last updated <strong>20 August 2026</strong>.
        </p>
      </Section>
    </div>
  );
}
