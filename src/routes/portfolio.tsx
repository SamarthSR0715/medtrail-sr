import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Award,
  Check,
  Instagram,
  Linkedin,
  Mail,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { socials } from "@/lib/site-data";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — Samarth Rautrao | MedTrail" },
      {
        name: "description",
        content:
          "About Samarth Rautrao: MBBS student, trekker and builder. Certificates, projects and ways to get in touch.",
      },
      { property: "og:title", content: "Portfolio — Samarth Rautrao" },
      {
        property: "og:description",
        content: "MBBS student, trekker and builder — certificates, projects and contact.",
      },
    ],
  }),
  component: Portfolio,
});

const certificates = [
  { title: "Basic Life Support (BLS)", issuer: "Indian Resuscitation Council", year: "2025" },
  { title: "Advanced Cardiac Life Support", issuer: "AHA aligned programme", year: "2025" },
  { title: "Research Methodology Workshop", issuer: "Medical College CME", year: "2024" },
  { title: "First Aid & Trek Safety", issuer: "Sahyadri Trekkers Guild", year: "2024" },
];

const projects = [
  {
    title: "MedTrail",
    copy: "This workspace — study planning, travel logging and fitness tracking in one calm interface.",
    tags: ["Design", "React", "Product"],
  },
  {
    title: "Anatomy Recall Deck",
    copy: "A spaced-repetition flashcard set covering high-yield first-year anatomy for peer study groups.",
    tags: ["Education", "Content"],
  },
  {
    title: "Sahyadri Trail Notes",
    copy: "Field notes and budget breakdowns for 30+ Maharashtra treks, shared with first-time trekkers.",
    tags: ["Writing", "Travel"],
  },
];

function Portfolio() {
  const [sent, setSent] = useState(false);
  const inputCls =
    "w-full rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm outline-none transition-colors focus:border-primary/70";

  return (
    <div className="px-4">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Portfolio"
          title={<>Samarth Rautrao</>}
          description="MBBS student in Maharashtra. I study hard, climb often, and build small tools that make both easier."
        />

        <Reveal delay={90} className="mt-10">
          <div className="glass grid gap-8 rounded-[2rem] p-7 sm:p-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <span className="bg-gradient-brand flex size-14 items-center justify-center rounded-3xl text-brand-foreground shadow-lg">
                <Stethoscope className="size-6" aria-hidden="true" />
              </span>
              <h3 className="mt-6 text-xl font-semibold">About</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {["MBBS student", "Trekker", "Design-minded"].map((t) => (
                  <span key={t} className="rounded-full bg-secondary/70 px-3 py-1 text-xs font-medium">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                Most of my week is lectures, dissection hall and revision blocks. The rest belongs to
                the Sahyadris — forts before sunrise, waterfalls in July, and long drives with a
                notebook in the bag.
              </p>
              <p>
                MedTrail started as a personal fix: too many apps for study plans, trip budgets and
                gym logs. Now it is one place, built to feel quiet and premium so it never adds to
                the noise of a clinical week.
              </p>
              <p className="flex items-center gap-2 text-foreground">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                Open to research assistance, med-ed content and collaborations.
              </p>
            </div>
          </div>
        </Reveal>

        <h2 className="mt-20 text-2xl font-semibold sm:text-3xl">Certificates</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {certificates.map((c, i) => (
            <Reveal key={c.title} delay={i * 70}>
              <article className="glass flex h-full items-start gap-4 rounded-[1.5rem] p-6">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/70">
                  <Award className="size-5 text-primary" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold leading-snug">{c.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {c.issuer} · {c.year}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <h2 className="mt-20 text-2xl font-semibold sm:text-3xl">Projects</h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {projects.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <article className="glass flex h-full flex-col rounded-[1.5rem] p-6 transition-transform duration-500 hover:-translate-y-1.5">
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted-foreground">{p.copy}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-full bg-secondary/70 px-2.5 py-1 text-xs">
                      {t}
                    </span>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <h2 className="mt-20 text-2xl font-semibold sm:text-3xl">Contact</h2>
        <Reveal delay={80} className="mt-6">
          <div className="glass grid gap-8 rounded-[2rem] p-7 sm:p-10 lg:grid-cols-2">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
            >
              <input className={inputCls} placeholder="Your name" aria-label="Your name" required />
              <input
                className={inputCls}
                type="email"
                placeholder="Email"
                aria-label="Email"
                required
              />
              <textarea
                className={inputCls}
                rows={4}
                placeholder="Say hello…"
                aria-label="Message"
                required
              />
              <button
                type="submit"
                className="bg-gradient-brand inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:scale-[1.03]"
              >
                {sent ? <Check className="size-4" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
                {sent ? "Message noted" : "Send message"}
              </button>
              {sent ? (
                <p className="text-xs text-muted-foreground">
                  Thanks! For a faster reply, reach me on Instagram or LinkedIn.
                </p>
              ) : null}
            </form>

            <div className="flex flex-col gap-3">
              <a
                href={socials.instagram}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-4 rounded-2xl border border-border/50 bg-secondary/35 p-5 transition-colors hover:bg-secondary/60"
              >
                <Instagram className="size-5 text-primary" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">Instagram</span>
                  <span className="block text-xs text-muted-foreground">@samarth_rautrao_07</span>
                </span>
              </a>
              <a
                href={socials.linkedin}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-4 rounded-2xl border border-border/50 bg-secondary/35 p-5 transition-colors hover:bg-secondary/60"
              >
                <Linkedin className="size-5 text-primary" aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold">LinkedIn</span>
                  <span className="block text-xs text-muted-foreground">Samarth Rautrao</span>
                </span>
              </a>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}