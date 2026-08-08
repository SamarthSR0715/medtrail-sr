import {  useEffect,useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  FileText,
  Layers,
  RotateCcw,
  Target,
} from "lucide-react";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/mbbs")({
  head: () => ({
    meta: [
      { title: "MBBS Study Hub| Study Planner, Notes, Flashcards & MCQ | MedTrailSR" },
      {
        name: "description",
        content:
          "MedtrailSR MBBS Sudy Hub offers study planner, subject notes library, flashcard revision and self-scored MCQ,Revision tools and resource to help medical tudents prepare ectively.",
      },
      { property: "og:title", content: "MBBS Study Hub|Planner, Notes, Flashcards & McQ|MedtrailSR" },
      {
        property: "og:description",
        content: "Study Anatomy,Physiology,Biochemitry and oter MBBS Subjectsusing planner, notes library, flashcards and quizzes for MBBS revision.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://medtrail-sr.lovable.app/mbbs" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://medtrail-sr.lovable.app/mbbs" }],
  }),
  component: MbbsHub,
});

const planner = [
  { id: 1, day: "Mon", subject: "Anatomy", task: "Upper limb — brachial plexus", hrs: 2.5 },
  { id: 2, day: "Tue", subject: "Physiology", task: "Cardiac cycle + ECG basics", hrs: 2 },
  { id: 3, day: "Wed", subject: "Biochemistry", task: "Glycolysis regulation", hrs: 1.5 },
  { id: 4, day: "Thu", subject: "Anatomy", task: "Histology slides revision", hrs: 2 },
  { id: 5, day: "Fri", subject: "Physiology", task: "Renal clearance problems", hrs: 2 },
  { id: 6, day: "Sat", subject: "Mixed", task: "Full-length MCQ block", hrs: 3 },
];

const notes = [
  { subject: "Anatomy", title: "Brachial Plexus Simplified", pages: 14, tag: "Diagrams" },
  { subject: "Physiology", title: "Cardiac Cycle Cheatsheet", pages: 8, tag: "High yield" },
  { subject: "Biochemistry", title: "Metabolic Pathways Map", pages: 11, tag: "Flowcharts" },
  { subject: "Pathology", title: "Inflammation Cascade", pages: 9, tag: "High yield" },
  { subject: "Pharmacology", title: "Autonomic Drugs Table", pages: 6, tag: "Tables" },
  { subject: "Microbiology", title: "Gram Stain Quick Recall", pages: 5, tag: "Mnemonics" },
];

const cards = [
  { q: "Nerve injured in a mid-shaft humerus fracture?", a: "Radial nerve — wrist drop follows." },
  { q: "Normal ejection fraction range?", a: "55–70% of end-diastolic volume." },
  { q: "Rate-limiting enzyme of glycolysis?", a: "Phosphofructokinase-1." },
  { q: "Vitamin deficiency causing megaloblastic anaemia?", a: "B12 or folate deficiency." },
];

const quiz = [
  {
    q: "Which vessel supplies the SA node in most people?",
    options: ["Left circumflex", "Right coronary artery", "Left anterior descending", "Posterior descending"],
    answer: 1,
  },
  {
    q: "Which muscle abducts the arm beyond 15 degrees?",
    options: ["Supraspinatus", "Deltoid", "Teres minor", "Subscapularis"],
    answer: 1,
  },
  {
    q: "Insulin primarily acts through which receptor type?",
    options: ["G-protein coupled", "Ligand-gated ion channel", "Receptor tyrosine kinase", "Nuclear receptor"],
    answer: 2,
  },
];

const tabs = [
  { id: "planner", label: "Study planner", icon: Target },
  { id: "notes", label: "Notes", icon: FileText },
  { id: "cards", label: "Flashcards", icon: Layers },
  { id: "quiz", label: "Quiz", icon: BookOpen },
] as const;

function MbbsHub() {
  
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("planner");
  const [done, setDone] = useState<number[]>([1, 2]);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
    useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (mounted) {
        setSession(session);
        setAuthLoading(false);
      }
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const totalHrs = planner.reduce((sum, p) => sum + p.hrs, 0);
  const doneHrs = planner.filter((p) => done.includes(p.id)).reduce((s, p) => s + p.hrs, 0);
  const progress = Math.round((doneHrs / totalHrs) * 100);
  const score = useMemo(
    () => quiz.filter((q, i) => answers[i] === q.answer).length,
    [answers],
  );

  return (
    <div className="px-4">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="MBBS Hub"
          title={<>MBBS Study Hub</>}
          description=" Orginise your MBBS Studies With a planner, revision notes, flashds and mcq study resource designed for mbbs students."
        />

        <Reveal delay={100} className="mt-10">
          <div className="glass flex w-full gap-1 overflow-x-auto rounded-full p-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all",
                  tab === t.id
                    ? "bg-gradient-brand text-brand-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-4" aria-hidden="true" />
                {t.label}
              </button>
            ))}
          </div>
        </Reveal>

        {tab === "planner" ? (
          <Reveal className="mt-8 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="glass rounded-[1.75rem] p-6 sm:p-8">
              <h3 className="text-lg font-semibold">This week</h3>
              <ul className="mt-5 space-y-3">
                {planner.map((p) => {
                  const checked = done.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setDone((d) => (checked ? d.filter((x) => x !== p.id) : [...d, p.id]))
                        }
                        className="flex w-full items-center gap-4 rounded-2xl border border-border/50 bg-secondary/35 px-4 py-3.5 text-left transition-colors hover:bg-secondary/60"
                      >
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                            checked
                              ? "border-transparent bg-gradient-brand text-brand-foreground"
                              : "border-border",
                          )}
                        >
                          {checked ? <Check className="size-3.5" /> : null}
                        </span>
                        <span className="min-w-10 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {p.day}
                        </span>
                        <span className="flex-1">
                          <span
                            className={cn(
                              "block text-sm font-medium",
                              checked && "text-muted-foreground line-through",
                            )}
                          >
                            {p.task}
                          </span>
                          <span className="text-xs text-muted-foreground">{p.subject}</span>
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">{p.hrs}h</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="glass flex h-fit flex-col gap-8 rounded-[1.75rem] p-6 sm:p-8">
              <div>
                <h3 className="text-lg font-semibold">Weekly load</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {doneHrs}h of {totalHrs}h complete
                </p>
              </div>
              <div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="bg-gradient-brand h-full rounded-full transition-all duration-700"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="font-display mt-5 text-5xl font-semibold">{progress}%</p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Plan adherence
                </p>
              </div>
            </div>
          </Reveal>
        ) : null}

        {tab === "notes" ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((n, i) => (
              <Reveal key={n.title} delay={i * 70}>
                <article className="glass h-full rounded-[1.5rem] p-6 transition-transform duration-500 hover:-translate-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    {n.subject}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold leading-snug">{n.title}</h3>
                  <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="rounded-full bg-secondary/70 px-2.5 py-1">{n.tag}</span>
                    <span>{n.pages} pages</span>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        ) : null}

        {tab === "cards" ? (
          <Reveal className="mt-8">
            <div className="glass mx-auto max-w-xl rounded-[1.75rem] p-7 sm:p-10">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Card {cardIdx + 1} of {cards.length}
              </p>
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className="mt-5 flex min-h-44 w-full items-center justify-center rounded-3xl border border-border/60 bg-secondary/40 px-6 py-8 text-center text-lg font-medium leading-snug transition-colors hover:bg-secondary/65"
              >
                {flipped ? cards[cardIdx]?.a : cards[cardIdx]?.q}
              </button>
              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setFlipped((f) => !f)}
                  className="glass flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {flipped ? "Show question" : "Reveal answer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFlipped(false);
                    setCardIdx((i) => (i + 1) % cards.length);
                  }}
                  className="bg-gradient-brand rounded-full px-5 py-2.5 text-sm font-semibold text-brand-foreground"
                >
                  Next card
                </button>
              </div>
            </div>
          </Reveal>
        ) : null}

        {tab === "quiz" ? (
          <Reveal className="mt-8">
            <div className="glass mx-auto max-w-2xl rounded-[1.75rem] p-7 sm:p-10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Rapid MCQ block</h3>
                <span className="rounded-full bg-secondary/70 px-3 py-1 text-sm font-medium">
                  {score}/{quiz.length}
                </span>
              </div>
              <ol className="mt-6 space-y-7">
                {quiz.map((q, qi) => (
                  <li key={q.q}>
                    <p className="text-sm font-medium leading-relaxed">
                      {qi + 1}. {q.q}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {q.options.map((opt, oi) => {
                        const picked = answers[qi] === oi;
                        const correct = q.answer === oi;
                        const answered = answers[qi] !== undefined;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                            className={cn(
                              "rounded-2xl border px-4 py-3 text-left text-sm transition-colors",
                              answered && correct
                                ? "border-primary/70 bg-primary/12 text-foreground"
                                : picked
                                  ? "border-destructive/60 bg-destructive/12"
                                  : "border-border/60 bg-secondary/35 hover:bg-secondary/60",
                            )}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => setAnswers({})}
                className="glass mt-8 rounded-full px-5 py-2.5 text-sm font-medium"
              >
                Reset quiz
              </button>
            </div>
          </Reveal>
        ) : null}
      </section>
    </div>
  );
}
