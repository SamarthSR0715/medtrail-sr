import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Dumbbell,
  HeartPulse,
  Mountain,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { realPhotos, travelStats } from "@/lib/travel-content";

const SITE = "https://medtrail-sr.lovable.app";
const heroImg = realPhotos.pawnaFromTikona;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MedTrailSR| MBBS Study hub & Weekend gateways Near Pune and Mumbai"},
      {
        name: "description",
        content:
          "MedTrailSR helps MBBS students discover study resources, Sahyadri treks, nature trails, forts, waterfalls, and budget-friendly weekend getaways across Pune, Mumbai, Lonavala, and Maharashtra.",},

    
      { property: "og:title", content: "MedTrailSR| MBBS Study Hub and Weekend Getaways Near Pune and Mumbai", },
      {
        property: "og:description",
        content:
          "MedtrailSR| is a platform for MBBS students featuring Study respurces,Sahyadri trekking guides,weekend gateways,fitness tracking, and student life across Maharashtra",},
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/` },
      { property: "og:image", content: `${SITE}${heroImg}` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${SITE}${heroImg}` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "MedTrail",
          url: SITE,
          description:
            "MedtrailSR is a platform for MBBS Students featuring Study resources,Sahyadri trekking guides,weekend gateways, fitness and student lifestyle in Maharashtra",
          author: {
            "@type": "Person",
            name: "Samarth Rautrao",
            description: "Founder of MedtrailSR,Sharing MBBS Study resources,Sahyadri travel experiences, fitness,and student lifestyle.",
            sameAs: [
              "https://www.instagram.com/samarth_rautrao_07",
              "https://www.linkedin.com/in/samarth-rautrao-859804411",
            ],
          },
        }),
      },
    ],
  }),
  component: Index,
});

const pillars = [
  {
    to: "/mbbs",
    icon: BookOpen,
    title: "MBBS Hub",
    copy: "Planner, notes, flashcards and quizzes built for long study blocks.",
  },
  {
    to: "/travel",
    icon: Mountain,
    title: "Travel Journal",
    copy: "Forts, waterfalls and hill stations across Maharashtra on one map.",
  },
  {
    to: "/fitness",
    icon: Dumbbell,
    title: "Fitness Tracker",
    copy: "Workout logs, BMI, hydration and progress charts that stay honest.",
  },
  {
    to: "/portfolio",
    icon: UserRound,
    title: "Portfolio",
    copy: "About, certificates, projects and a direct line to say hello.",
  },
];

const stats = [
  { value: "19", label: "Subjects tracked" },
  { value: String(travelStats.destinations), label: "Trips documented" },
  { value: String(travelStats.photos), label: "Original photos" },
  { value: "412", label: "Workouts done" },
];

function Index() {
  return (
    <div className="px-4">
      <section className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem]">
        <img
          src={heroImg}
          alt="Pawna Lake and the Sahyadri ridges seen from the summit of Tikona Fort"
          width={1920}
          height={1088}
          fetchPriority="high"
          className="h-[78svh] min-h-[520px] w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-12">
          <Reveal>
            <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium tracking-wide">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Personal OS of Samarth Rautrao
            </span>
          </Reveal>
          <Reveal delay={120}>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-6xl md:text-7xl">
              Medicine, mountains and <span className="text-gradient">momentum</span>.
            </h1>
          </Reveal>
          <Reveal delay={220}>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              MedTrail keeps studying, travelling and training in one quiet, beautiful place —
              designed to feel effortless on every screen.
            </p>
          </Reveal>
          <Reveal delay={320}>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/mbbs"
                className="bg-gradient-brand inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-[1.03]"
              >
                Open MBBS Hub <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                to="/travel"
                className="glass inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:scale-[1.03]"
              >
                Explore the map
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl">
        <SectionHeading
          eyebrow="Five spaces"
          title="Everything I build, study and climb"
          description="Each space is self-contained yet shares the same calm design language, so switching context never costs focus."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {pillars.map((p, i) => (
            <Reveal key={p.to} delay={i * 90}>
              <Link
                to={p.to}
                className="glass group flex h-full flex-col rounded-[1.75rem] p-7 transition-all duration-500 hover:-translate-y-1.5"
              >
                <span className="bg-gradient-brand flex size-12 items-center justify-center rounded-2xl text-brand-foreground shadow-md">
                  <p.icon className="size-5.5" aria-hidden="true" />
                </span>
                <h3 className="mt-6 text-xl font-semibold">{p.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{p.copy}</p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Enter
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl">
        <Reveal className="glass grid grid-cols-2 gap-6 rounded-[2rem] p-8 sm:grid-cols-4 sm:p-10">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-display text-3xl font-semibold sm:text-4xl">{s.value}</p>
              <p className="mt-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {s.label}
              </p>
            </div>
          ))}
        </Reveal>
      </section>

      <section className="mx-auto mt-20 max-w-6xl">
        <Reveal className="glass relative overflow-hidden rounded-[2rem] p-8 text-center sm:p-14">
          <HeartPulse className="mx-auto size-9 text-primary" aria-hidden="true" />
          <h2 className="mt-5 text-2xl font-semibold sm:text-4xl">
            Consistency beats intensity — every single week.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Track a lecture, a trek and a workout in the same afternoon. MedTrail keeps the streak
            visible without the noise.
          </p>
          <Link
            to="/fitness"
            className="bg-gradient-brand mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-[1.03]"
          >
            Start tracking <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
