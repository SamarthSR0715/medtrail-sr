import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Beef, Droplet, Dumbbell, Minus, Plus, Scale, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Reveal } from "@/components/site/reveal";
import { SectionHeading } from "@/components/site/section-heading";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fitness")({
  head: () => ({
    meta: [
      { title: "Fitness Tracker — Workouts, BMI, Hydration & Progress | MedTrail" },
      {
        name: "description",
        content:
          "Log workouts, calculate BMI, track hydration and watch weekly training volume trend on clean progress charts.",
      },
      { property: "og:title", content: "Fitness Tracker — Workouts, BMI & Hydration" },
      {
        property: "og:description",
        content: "Workout logs, BMI calculator, hydration goals and progress charts.",
      },
    ],
  }),
  component: FitnessTracker,
});

type Log = { id: number; name: string; sets: number; reps: number; weight: number };

const seedLogs: Log[] = [
  { id: 1, name: "Barbell squat", sets: 4, reps: 8, weight: 70 },
  { id: 2, name: "Bench press", sets: 4, reps: 8, weight: 50 },
  { id: 3, name: "Deadlift", sets: 3, reps: 5, weight: 95 },
  { id: 4, name: "Pull-ups", sets: 4, reps: 10, weight: 0 },
];

const trend = [
  { week: "W1", volume: 8200, weight: 68.4 },
  { week: "W2", volume: 8900, weight: 68.1 },
  { week: "W3", volume: 9600, weight: 67.6 },
  { week: "W4", volume: 9300, weight: 67.4 },
  { week: "W5", volume: 10400, weight: 67 },
  { week: "W6", volume: 11200, weight: 66.5 },
];

const dietFactors = [
  { id: "veg", label: "Vegetarian", factor: 1.8, note: "Dal, paneer, curd, soy" },
  { id: "eggetarian", label: "Eggetarian", factor: 1.9, note: "Eggs + dairy staples" },
  { id: "nonveg", label: "Non-veg", factor: 2.0, note: "Chicken, fish, eggs" },
  { id: "vegan", label: "Vegan", factor: 1.7, note: "Soy, tofu, legumes" },
] as const;

const goalFactors = [
  { id: "maintain", label: "Maintain", mult: 0.9 },
  { id: "build", label: "Build muscle", mult: 1 },
  { id: "cut", label: "Fat loss", mult: 1.05 },
] as const;

function FitnessTracker() {
  const [logs, setLogs] = useState<Log[]>(seedLogs);
  const [form, setForm] = useState({ name: "", sets: "3", reps: "10", weight: "40" });
  const [height, setHeight] = useState("175");
  const [weight, setWeight] = useState("67");
  const [glasses, setGlasses] = useState(5);
  const goal = 10;
  const [diet, setDiet] = useState<(typeof dietFactors)[number]["id"]>("veg");
  const [proteinGoal, setProteinGoal] = useState<(typeof goalFactors)[number]["id"]>("build");

  const volume = logs.reduce((s, l) => s + l.sets * l.reps * (l.weight || 1), 0);

  const bmi = useMemo(() => {
    const h = Number(height) / 100;
    const w = Number(weight);
    if (!h || !w) return null;
    return w / (h * h);
  }, [height, weight]);

  const dietPick = dietFactors.find((d) => d.id === diet)!;
  const goalPick = goalFactors.find((g) => g.id === proteinGoal)!;
  const protein = useMemo(() => {
    const w = Number(weight);
    if (!w) return null;
    return Math.round(w * dietPick.factor * goalPick.mult);
  }, [weight, dietPick, goalPick]);

  const bmiBand = !bmi
    ? ""
    : bmi < 18.5
      ? "Underweight"
      : bmi < 25
        ? "Healthy range"
        : bmi < 30
          ? "Overweight"
          : "Obese";

  const addLog = () => {
    if (!form.name.trim()) return;
    setLogs((l) => [
      ...l,
      {
        id: Date.now(),
        name: form.name.trim(),
        sets: Number(form.sets) || 0,
        reps: Number(form.reps) || 0,
        weight: Number(form.weight) || 0,
      },
    ]);
    setForm({ name: "", sets: "3", reps: "10", weight: "40" });
  };

  const inputCls =
    "w-full rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm outline-none transition-colors focus:border-primary/70";

  return (
    <div className="px-4">
      <section className="mx-auto max-w-6xl">
        <SectionHeading
          align="left"
          eyebrow="Fitness Tracker"
          title={<>Train around the timetable.</>}
          description="Log the session, sip the water, watch the line climb. Simple inputs, honest numbers, zero clutter."
        />

        <div className="mt-10 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <div className="glass rounded-[1.75rem] p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <Dumbbell className="size-5 text-primary" aria-hidden="true" />
                <h3 className="text-lg font-semibold">Today's workout</h3>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-[1.6fr_repeat(3,0.7fr)]">
                <input
                  className={inputCls}
                  placeholder="Exercise"
                  aria-label="Exercise name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <input
                  className={inputCls}
                  inputMode="numeric"
                  aria-label="Sets"
                  placeholder="Sets"
                  value={form.sets}
                  onChange={(e) => setForm({ ...form, sets: e.target.value })}
                />
                <input
                  className={inputCls}
                  inputMode="numeric"
                  aria-label="Reps"
                  placeholder="Reps"
                  value={form.reps}
                  onChange={(e) => setForm({ ...form, reps: e.target.value })}
                />
                <input
                  className={inputCls}
                  inputMode="numeric"
                  aria-label="Weight in kg"
                  placeholder="kg"
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                />
              </div>
              <button
                type="button"
                onClick={addLog}
                className="bg-gradient-brand mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-md transition-transform hover:scale-[1.03]"
              >
                <Plus className="size-4" aria-hidden="true" /> Add set
              </button>

              <ul className="mt-7 space-y-2.5">
                {logs.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between rounded-2xl border border-border/50 bg-secondary/35 px-4 py-3.5"
                  >
                    <span className="text-sm font-medium">{l.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {l.sets} × {l.reps}
                      {l.weight ? ` · ${l.weight} kg` : " · bodyweight"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-muted-foreground">
                Session volume{" "}
                <span className="font-semibold text-foreground">
                  {volume.toLocaleString("en-IN")} kg
                </span>
              </p>
            </div>
          </Reveal>

          <div className="grid gap-5">
            <Reveal delay={100}>
              <div className="glass rounded-[1.75rem] p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <Scale className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="text-lg font-semibold">BMI</h3>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Height (cm)
                    <input
                      className={cn(inputCls, "mt-2")}
                      inputMode="numeric"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                    />
                  </label>
                  <label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Weight (kg)
                    <input
                      className={cn(inputCls, "mt-2")}
                      inputMode="numeric"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                    />
                  </label>
                </div>
                <p className="font-display mt-6 text-4xl font-semibold">
                  {bmi ? bmi.toFixed(1) : "—"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{bmiBand}</p>
              </div>
            </Reveal>

            <Reveal delay={180}>
              <div className="glass rounded-[1.75rem] p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <Droplet className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="text-lg font-semibold">Hydration</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {glasses} of {goal} glasses · {(glasses * 0.25).toFixed(2)} L
                </p>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {Array.from({ length: goal }).map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-9 w-5 rounded-md transition-colors",
                        i < glasses ? "bg-gradient-brand" : "bg-secondary",
                      )}
                    />
                  ))}
                </div>
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    aria-label="Remove a glass"
                    onClick={() => setGlasses((g) => Math.max(0, g - 1))}
                    className="glass flex size-10 items-center justify-center rounded-full"
                  >
                    <Minus className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Add a glass"
                    onClick={() => setGlasses((g) => Math.min(goal, g + 1))}
                    className="bg-gradient-brand flex size-10 items-center justify-center rounded-full text-brand-foreground"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <div className="glass rounded-[1.75rem] p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <Beef className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="text-lg font-semibold">Protein target</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Based on your weight ({weight || "—"} kg), diet and goal.
                </p>

                <div className="mt-5 flex flex-wrap gap-1.5">
                  {dietFactors.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDiet(d.id)}
                      className={cn(
                        "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                        diet === d.id
                          ? "bg-gradient-brand text-brand-foreground"
                          : "bg-secondary/70 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {goalFactors.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setProteinGoal(g.id)}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                        proteinGoal === g.id
                          ? "border-primary/70 text-foreground"
                          : "border-border/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>

                <p className="font-display mt-6 text-4xl font-semibold">
                  {protein ? `${protein} g` : "—"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {protein ? `≈ ${Math.round(protein / 4)} g per meal across 4 meals` : "Enter a weight above"}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">{dietPick.note}</p>
              </div>
            </Reveal>
          </div>
        </div>

        <Reveal delay={80} className="mt-5">
          <div className="glass rounded-[1.75rem] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <TrendingUp className="size-5 text-primary" aria-hidden="true" />
              <h3 className="text-lg font-semibold">Six-week progress</h3>
            </div>
            <div className="mt-6 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.55" />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 16,
                      color: "var(--popover-foreground)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    stroke="var(--chart-1)"
                    strokeWidth={2.5}
                    fill="url(#vol)"
                    name="Volume (kg)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}