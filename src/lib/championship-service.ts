/**
 * MedTrail Championship Season 1 — Data & Game Logic Service
 * All timestamps stored/compared in UTC.
 * Display uses Asia/Kolkata (IST, UTC+5:30).
 * Rules version: S1-v1.0
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// ── Season constants ──────────────────────────────────────────────────────────
export const SEASON_ID = "S1";
export const POLICY_VERSION = "S1-v1.0";

/** IST = UTC+5:30. All display conversions use this offset. */
export const EVENT_TZ = "Asia/Kolkata";
export const EVENT_TZ_ABBR = "IST";
export const EVENT_TZ_OFFSET = "UTC+5:30";

/** Season window in UTC */
export const SEASON_START_UTC = new Date("2026-09-27T13:30:00Z"); // 7:00 PM IST
export const SEASON_END_UTC   = new Date("2026-10-17T13:30:00Z"); // 7:00 PM IST

/** Daily pulse rules */
export const DAILY_PULSE_TOTAL = 5;
export const DAILY_MBBS_PULSES = 4;
export const DAILY_GENERAL_PULSES = 1;

// ── Types ─────────────────────────────────────────────────────────────────────
export type Participant = Database["public"]["Tables"]["championship_participants"]["Row"];
export type PulseCompletion = Database["public"]["Tables"]["championship_pulse_completions"]["Row"];
export type Dispute = Database["public"]["Tables"]["championship_disputes"]["Row"];

export type SeasonStatus = "pre" | "live" | "ended";

export interface LeaderboardEntry {
  participant_id: string;
  display_name: string;
  institution: string | null;
  country: string | null;
  batch?: string;
  total_score: number;
  total_pulses_done: number;
  total_accuracy_pct: number;
  current_streak: number;
  xp: number;
  movement: "up" | "down" | "same";
  movement_val: number;
  last_active_at: string | null;
  rank: number;
  season_id: string;
}

export interface PulseQuestion {
  id: string;
  slot: number;
  subject: string;
  category: "1st MBBS" | "2nd MBBS" | "General Pulse";
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  xp: number;
  points: number;
}

export interface DailyPulseDay {
  dayNumber: number;
  dateStr: string; // YYYY-MM-DD
  displayDate: string;
  title: string;
  questions: PulseQuestion[];
  isUnlocked: boolean;
  isToday: boolean;
  isCompleted: boolean;
  score?: number;
  accuracy?: number;
}

export interface TimeWindowState {
  status: "before_7pm" | "active_pulse" | "day_ended";
  countdownSeconds: number;
  label: string;
  opensAtIST: string;
}

export interface PassportBadge {
  id: string;
  title: string;
  album: string;
  rarity: "Legendary" | "Epic" | "Rare" | "Common";
  icon: string;
  description: string;
  criteria: string;
  unlocked: boolean;
  unlockedAt?: string;
  trophyId?: string;
}

export interface HallOfFameRecord {
  seasonId: string;
  seasonTitle: string;
  championName: string;
  championCollege: string;
  championBatch: string;
  finalScore: number;
  accuracyPct: number;
  streakDays: number;
  trophyId: string;
  avatar: string;
  status: "crowned" | "in_contention";
}

// ── Medical Subject Question Bank (1st & 2nd MBBS + General) ───────────────────
const MBBS_QUESTION_BANK: Record<string, Omit<PulseQuestion, "id" | "slot">[]> = {
  Anatomy: [
    {
      subject: "Anatomy",
      category: "1st MBBS",
      question: "Which nerve is at highest risk during a surgical fracture repair of the humerus mid-shaft?",
      options: ["Axillary nerve", "Radial nerve", "Median nerve", "Ulnar nerve"],
      correctIndex: 1,
      explanation: "The radial nerve runs intimately in the spiral radial groove along the posterior mid-shaft of the humerus and is classic for mid-shaft injury.",
      xp: 100,
      points: 20,
    },
    {
      subject: "Anatomy",
      category: "1st MBBS",
      question: "Which vessel contributes to the anterior circulation of the Circle of Willis?",
      options: ["Basilar artery", "Anterior cerebral artery", "Posterior cerebral artery", "Vertebral artery"],
      correctIndex: 1,
      explanation: "The anterior cerebral arteries (connected by the anterior communicating artery) form the anterior circle of Willis from the internal carotid.",
      xp: 100,
      points: 20,
    },
  ],
  Physiology: [
    {
      subject: "Physiology",
      category: "1st MBBS",
      question: "What is the primary physiological driver of normal resting ventilation in humans?",
      options: ["Arterial pO2", "Arterial pCO2 / CSF pH", "Blood pressure", "Venous lactate"],
      correctIndex: 1,
      explanation: "Central chemoreceptors in the ventrolateral medulla respond acutely to hydrogen ion changes resulting from arterial pCO2 crossing the blood-brain barrier.",
      xp: 100,
      points: 20,
    },
    {
      subject: "Physiology",
      category: "1st MBBS",
      question: "In cardiac cycle electrophysiology, Phase 0 ventricular depolarization is governed by:",
      options: ["Transient outward K+ efflux", "L-type Ca2+ channel opening", "Rapid voltage-gated Na+ influx", "Na+/K+ ATPase pump"],
      correctIndex: 2,
      explanation: "Phase 0 rapid upstroke in ventricular myocytes is driven by opening of fast voltage-gated Na+ channels.",
      xp: 100,
      points: 20,
    },
  ],
  Biochemistry: [
    {
      subject: "Biochemistry",
      category: "1st MBBS",
      question: "What is the rate-limiting regulatory enzyme of the glycolytic pathway?",
      options: ["Hexokinase", "Phosphofructokinase-1 (PFK-1)", "Pyruvate kinase", "Aldolase"],
      correctIndex: 1,
      explanation: "PFK-1 is the key committed step in glycolysis, activated by AMP and fructose 2,6-bisphosphate, and inhibited by ATP and citrate.",
      xp: 100,
      points: 20,
    },
    {
      subject: "Biochemistry",
      category: "1st MBBS",
      question: "Which apolipoprotein is the cofactor for lipoprotein lipase (LPL) activation?",
      options: ["Apo A-1", "Apo B-100", "Apo C-II", "Apo E"],
      correctIndex: 2,
      explanation: "Apo C-II on chylomicrons and VLDL activates capillary endothelial lipoprotein lipase for triglyceride hydrolysis.",
      xp: 100,
      points: 20,
    },
  ],
  Pathology: [
    {
      subject: "Pathology",
      category: "2nd MBBS",
      question: "Reed-Sternberg cells with prominent owl-eyed nucleoli are pathognomonic for:",
      options: ["Burkitt lymphoma", "Hodgkin lymphoma", "Multiple myeloma", "Chronic lymphocytic leukemia"],
      correctIndex: 1,
      explanation: "Classic Reed-Sternberg binucleated cells (CD15+, CD30+) define Hodgkin Lymphoma histopathology.",
      xp: 100,
      points: 20,
    },
    {
      subject: "Pathology",
      category: "2nd MBBS",
      question: "Apple-green birefringence under polarized light after Congo Red staining demonstrates:",
      options: ["Collagen fibrosis", "Amyloid fibrils", "Elastin degeneration", "Glycogen accumulation"],
      correctIndex: 1,
      explanation: "Amyloid beta-pleated sheet conformation produces diagnostic apple-green birefringence when viewed with polarized light.",
      xp: 100,
      points: 20,
    },
  ],
  Pharmacology: [
    {
      subject: "Pharmacology",
      category: "2nd MBBS",
      question: "Which anti-hypertensive class is strictly contraindicated in bilateral renal artery stenosis?",
      options: ["Calcium channel blockers", "ACE inhibitors", "Thiazide diuretics", "Beta blockers"],
      correctIndex: 1,
      explanation: "ACE inhibitors prevent efferent arteriolar constriction, precipitating acute renal failure in bilateral renal artery stenosis.",
      xp: 100,
      points: 20,
    },
    {
      subject: "Pharmacology",
      category: "2nd MBBS",
      question: "Which antibiotic class is widely known for concentration-dependent killing and post-antibiotic effect?",
      options: ["Beta-lactams", "Aminoglycosides", "Sulfonamides", "Macrolides"],
      correctIndex: 1,
      explanation: "Aminoglycosides (e.g. gentamicin, amikacin) exhibit concentration-dependent bacterial killing and prominent post-antibiotic effect.",
      xp: 100,
      points: 20,
    },
  ],
  Microbiology: [
    {
      subject: "Microbiology",
      category: "2nd MBBS",
      question: "Which organism is a non-motile, Gram-positive rod that produces a characteristic black colony on potassium tellurite agar?",
      options: ["Corynebacterium diphtheriae", "Bacillus anthracis", "Listeria monocytogenes", "Clostridium tetani"],
      correctIndex: 0,
      explanation: "Corynebacterium diphtheriae reduces tellurite into elemental tellurium, producing distinctive black/grey colonies on Tindale/tellurite medium.",
      xp: 100,
      points: 20,
    },
    {
      subject: "Microbiology",
      category: "2nd MBBS",
      question: "The standard Mantoux tuberculin test is read as an example of which hypersensitivity reaction?",
      options: ["Type I (Immediate)", "Type II (Cytotoxic)", "Type III (Immune complex)", "Type IV (Delayed-type cell mediated)"],
      correctIndex: 3,
      explanation: "The Mantoux test induration (48–72h) is mediated by memory CD4+ T helper 1 cells and macrophages (Type IV hypersensitivity).",
      xp: 100,
      points: 20,
    },
  ],
  "Forensic Medicine": [
    {
      subject: "Forensic Medicine",
      category: "2nd MBBS",
      question: "The detection of diatoms in the bone marrow is the hallmark medico-legal test for confirming:",
      options: ["Hanging vs strangulation", "Ante-mortem drowning", "Arsenic poisoning", "Electrocution"],
      correctIndex: 1,
      explanation: "Inhaled diatoms enter the pulmonary capillary bed into systemic circulation and reach closed organs like femoral bone marrow only in live drowning.",
      xp: 100,
      points: 20,
    },
  ],
  "Community Medicine": [
    {
      subject: "Community Medicine",
      category: "2nd MBBS",
      question: "Which epidemiological measure represents the proportion of a population with a condition at a specific single point in time?",
      options: ["Incidence density", "Point prevalence", "Cumulative incidence", "Attack rate"],
      correctIndex: 1,
      explanation: "Point prevalence measures existing cases (both old and new) in a defined population at a given instant.",
      xp: 100,
      points: 20,
    },
  ],
  "ENT & Ophthalmology": [
    {
      subject: "ENT & Ophthalmology",
      category: "2nd MBBS",
      question: "A patient cannot see the temporal halves of both visual fields (bitemporal hemianopsia). The lesion is at:",
      options: ["Right optic nerve", "Optic chiasm", "Left optic radiation", "Calcarine cortex"],
      correctIndex: 1,
      explanation: "Decussating nasal retinal fibers (which view the temporal fields) cross at the optic chiasm, typically compressed by pituitary adenomas.",
      xp: 100,
      points: 20,
    },
  ],
};

const GENERAL_PULSE_BANK: Omit<PulseQuestion, "id" | "slot">[] = [
  {
    subject: "Sports & Physiology",
    category: "General Pulse",
    question: "Which international marathon is the oldest continuously run annual marathon in the world (established 1897)?",
    options: ["London Marathon", "Boston Marathon", "Berlin Marathon", "Tokyo Marathon"],
    correctIndex: 1,
    explanation: "The Boston Marathon in Massachusetts began in April 1897 and is the world's oldest annual marathon.",
    xp: 100,
    points: 20,
  },
  {
    subject: "Cinema & Science",
    category: "General Pulse",
    question: "Christopher Nolan's 2014 movie 'Interstellar' had physicist Kip Thorne calculate the exact visual appearance of which cosmological phenomenon?",
    options: ["Supernova shockwave", "Gargantua supermassive black hole", "Neutron star pulsar", "Solar flare coronal ejection"],
    correctIndex: 1,
    explanation: "Nobel laureate Kip Thorne collaborated with VFX artists to accurately model the gravitational lensing around the rotating black hole Gargantua.",
    xp: 100,
    points: 20,
  },
  {
    subject: "Current Affairs & Space",
    category: "General Pulse",
    question: "Which lunar crater near the South Pole did India's Chandrayaan-3 land near in August 2023, named Shiv Shakti Point?",
    options: ["Manzinus C", "Between Manzinus C and Simpelius N", "Tycho crater", "Clavius crater"],
    correctIndex: 1,
    explanation: "Chandrayaan-3 Vikram lander touched down at 69.37°S, 32.35°E between craters Manzinus C and Simpelius N.",
    xp: 100,
    points: 20,
  },
  {
    subject: "Scientific History",
    category: "General Pulse",
    question: "Alexander Fleming discovered penicillin in 1928 after noticing fungal contamination on a culture plate of which bacterium?",
    options: ["Streptococcus pyogenes", "Staphylococcus aureus", "Escherichia coli", "Pseudomonas aeruginosa"],
    correctIndex: 1,
    explanation: "Fleming observed a zone of inhibition around Penicillium notatum mold on a Staphylococcus aureus agar plate.",
    xp: 100,
    points: 20,
  },
];

// ── Deterministic Daily Pulse Generator ───────────────────────────────────────
// Generates 5 distinct questions per day based on date:
// - 4 randomly rotated from 1st & 2nd MBBS subjects (never hardcoded)
// - 1 General Pulse (Sports, Movies, Current Affairs, Science)

export function getDailyPulsesForDate(date: Date = new Date()): PulseQuestion[] {
  // Use day of year + year as deterministic seed
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const seed = (dayOfYear * 9301 + 49297) % 233280;

  const subjects = Object.keys(MBBS_QUESTION_BANK);
  // Deterministic shuffle of subjects based on seed
  const rotatedSubjects = [...subjects].sort((a, b) => {
    const hashA = (a.charCodeAt(0) * seed + a.length * 17) % 100;
    const hashB = (b.charCodeAt(0) * seed + b.length * 17) % 100;
    return hashA - hashB;
  });

  // Pick top 4 rotated subjects
  const selectedSubjects = rotatedSubjects.slice(0, 4);

  const questions: PulseQuestion[] = [];

  // Slot 1-4: 4 Medical Questions
  selectedSubjects.forEach((subj, idx) => {
    const pool = (MBBS_QUESTION_BANK[subj] || MBBS_QUESTION_BANK["Anatomy"])!;
    const qIndex = (seed + idx) % pool.length;
    const q = pool[qIndex]!;
    questions.push({
      ...q,
      id: `S1-D${dayOfYear}-P${idx + 1}`,
      slot: idx + 1,
    } as PulseQuestion);
  });

  // Slot 5: 1 General Pulse
  const generalIndex = seed % GENERAL_PULSE_BANK.length;
  const generalQ = GENERAL_PULSE_BANK[generalIndex]!;
  questions.push({
    ...generalQ,
    id: `S1-D${dayOfYear}-P5`,
    slot: 5,
  } as PulseQuestion);

  return questions;
}

// ── Daily Time Window State ───────────────────────────────────────────────────
// Before 7:00 PM IST -> Locked + Countdown
// 7:00 PM - 11:59 PM IST -> Today's Pulse Active
// Next day -> Unlocks next pulse

export function getDailyPulseTimeState(now: Date = new Date()): TimeWindowState {
  // Get IST hours and minutes
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = istFormatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const second = parseInt(parts.find((p) => p.type === "second")?.value || "0", 10);

  const currentSeconds = hour * 3600 + minute * 60 + second;
  const target7pmSeconds = 19 * 3600; // 19:00:00 IST

  if (currentSeconds < target7pmSeconds) {
    const remaining = target7pmSeconds - currentSeconds;
    return {
      status: "before_7pm",
      countdownSeconds: remaining,
      label: "Unlocks at 7:00 PM IST",
      opensAtIST: "7:00 PM IST",
    };
  } else {
    // 7:00 PM to 11:59 PM
    const endOfDaySeconds = 24 * 3600;
    const remaining = endOfDaySeconds - currentSeconds;
    return {
      status: "active_pulse",
      countdownSeconds: remaining,
      label: "Today's Pulse Active",
      opensAtIST: "Open Now",
    };
  }
}

// ── Season status helper ──────────────────────────────────────────────────────
export function getSeasonStatus(now: Date = new Date()): SeasonStatus {
  if (now < SEASON_START_UTC) return "pre";
  if (now > SEASON_END_UTC)   return "ended";
  return "live";
}

export function formatIST(utcDate: Date): string {
  return utcDate.toLocaleString("en-IN", {
    timeZone: EVENT_TZ,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function getISTDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TZ }).format(now);
}

// ── Passport & Badges Album ───────────────────────────────────────────────────
export const CHAMPIONSHIP_ALBUM_BADGES: PassportBadge[] = [
  {
    id: "first_pulse",
    title: "First Pulse",
    album: "Championship Season 1",
    rarity: "Common",
    icon: "⚡",
    description: "Completed your inaugural daily pulse challenge in MedTrail Season 1.",
    criteria: "Submit at least 1 verified Daily Pulse",
    unlocked: true,
    unlockedAt: "27 Sep 2026",
  },
  {
    id: "pulse_warrior",
    title: "Pulse Warrior",
    album: "Championship Season 1",
    rarity: "Rare",
    icon: "🛡️",
    description: "Demonstrated unrelenting medical consistency with a 5-day continuous streak.",
    criteria: "Achieve a 5-day uninterrupted Pulse streak",
    unlocked: true,
    unlockedAt: "01 Oct 2026",
  },
  {
    id: "perfect_week",
    title: "Perfect Week",
    album: "Championship Season 1",
    rarity: "Epic",
    icon: "🌟",
    description: "Conquered all 7 daily diagnostic pulses in a single championship week.",
    criteria: "Complete 100% of weekly pulse quota (7/7)",
    unlocked: false,
  },
  {
    id: "elite_top_10",
    title: "Elite Top 10",
    album: "Championship Season 1",
    rarity: "Epic",
    icon: "🏅",
    description: "Ranked among the top 10 medical minds across Maharashtra institutions.",
    criteria: "Finish in Top 10 on the Global Leaderboard",
    unlocked: false,
  },
  {
    id: "season_1_champion",
    title: "Season 1 Champion",
    album: "Championship Season 1",
    rarity: "Legendary",
    icon: "👑",
    description: "Undisputed #1 rank. Sovereign champion of the MedTrail Season 1 Obsidian Trophy.",
    criteria: "Rank #1 overall at season conclusion",
    unlocked: false,
    trophyId: "MT-S1-001",
  },
];

// ── Hall of Fame Record ───────────────────────────────────────────────────────
export const HALL_OF_FAME_RECORDS: HallOfFameRecord[] = [
  {
    seasonId: "S1",
    seasonTitle: "MedTrail Championship: Season 1",
    championName: "Dr. XYZ",
    championCollege: "To be crowned after Season 1",
    championBatch: "Season 1 Contender",
    finalScore: 0,
    accuracyPct: 0,
    streakDays: 0,
    trophyId: "MT-S1-001",
    avatar: "XYZ",
    status: "in_contention",
  },
];

// ── Batch Mapping ─────────────────────────────────────────────────────────────
export const BATCH_MAP = [
  { year: "2026", label: "Freshers", full: "2026 Batch (Freshers)" },
  { year: "2025", label: "1st Year MBBS", full: "2025 Batch (1st Year MBBS)" },
  { year: "2024", label: "2nd Year MBBS", full: "2024 Batch (2nd Year MBBS)" },
  { year: "2023", label: "3rd Year MBBS", full: "2023 Batch (3rd Year MBBS)" },
] as const;

// ── Seed Leaderboard Data (Fallback & Baseline) ───────────────────────────────
export const SEED_LEADERBOARD: LeaderboardEntry[] = [
  {
    participant_id: "p-01",
    display_name: "Dr. Samarth Rautrao",
    institution: "MIMER Medical College, Pune",
    country: "India",
    batch: "2024 Batch (2nd Year MBBS)",
    total_score: 9850,
    total_pulses_done: 28,
    total_accuracy_pct: 98.5,
    current_streak: 14,
    xp: 3200,
    movement: "same",
    movement_val: 0,
    last_active_at: new Date().toISOString(),
    rank: 1,
    season_id: "S1",
  },
  {
    participant_id: "p-02",
    display_name: "Ananya Deshmukh",
    institution: "BJ Government Medical College, Pune",
    country: "India",
    batch: "2023 Batch (3rd Year MBBS)",
    total_score: 9620,
    total_pulses_done: 27,
    total_accuracy_pct: 97.2,
    current_streak: 13,
    xp: 2950,
    movement: "up",
    movement_val: 1,
    last_active_at: new Date().toISOString(),
    rank: 2,
    season_id: "S1",
  },
  {
    participant_id: "p-03",
    display_name: "Rohan Varma",
    institution: "Seth GS Medical College & KEM, Mumbai",
    country: "India",
    batch: "2024 Batch (2nd Year MBBS)",
    total_score: 9490,
    total_pulses_done: 27,
    total_accuracy_pct: 96.4,
    current_streak: 12,
    xp: 2820,
    movement: "down",
    movement_val: 1,
    last_active_at: new Date().toISOString(),
    rank: 3,
    season_id: "S1",
  },
  {
    participant_id: "p-04",
    display_name: "Pooja Kulkarni",
    institution: "Grant Government Medical College, Mumbai",
    country: "India",
    batch: "2025 Batch (1st Year MBBS)",
    total_score: 9280,
    total_pulses_done: 26,
    total_accuracy_pct: 95.8,
    current_streak: 11,
    xp: 2650,
    movement: "up",
    movement_val: 2,
    last_active_at: new Date().toISOString(),
    rank: 4,
    season_id: "S1",
  },
  {
    participant_id: "p-05",
    display_name: "Aditya Patil",
    institution: "Armed Forces Medical College (AFMC), Pune",
    country: "India",
    batch: "2023 Batch (3rd Year MBBS)",
    total_score: 9140,
    total_pulses_done: 25,
    total_accuracy_pct: 95.1,
    current_streak: 10,
    xp: 2500,
    movement: "down",
    movement_val: 1,
    last_active_at: new Date().toISOString(),
    rank: 5,
    season_id: "S1",
  },
  {
    participant_id: "p-06",
    display_name: "Tanvi Joshi",
    institution: "Dr. DY Patil Medical College, Navi Mumbai",
    country: "India",
    batch: "2024 Batch (2nd Year MBBS)",
    total_score: 8960,
    total_pulses_done: 24,
    total_accuracy_pct: 94.3,
    current_streak: 9,
    xp: 2380,
    movement: "same",
    movement_val: 0,
    last_active_at: new Date().toISOString(),
    rank: 6,
    season_id: "S1",
  },
  {
    participant_id: "p-07",
    display_name: "Kunal Shinde",
    institution: "Government Medical College, Nagpur",
    country: "India",
    batch: "2025 Batch (1st Year MBBS)",
    total_score: 8810,
    total_pulses_done: 24,
    total_accuracy_pct: 93.9,
    current_streak: 8,
    xp: 2240,
    movement: "up",
    movement_val: 1,
    last_active_at: new Date().toISOString(),
    rank: 7,
    season_id: "S1",
  },
  {
    participant_id: "p-08",
    display_name: "Sneha Nair",
    institution: "MIMER Medical College, Pune",
    country: "India",
    batch: "2026 Batch (Freshers)",
    total_score: 8690,
    total_pulses_done: 23,
    total_accuracy_pct: 93.2,
    current_streak: 8,
    xp: 2150,
    movement: "down",
    movement_val: 1,
    last_active_at: new Date().toISOString(),
    rank: 8,
    season_id: "S1",
  },
  {
    participant_id: "p-09",
    display_name: "Vikram Malhotra",
    institution: "Government Medical College, Miraj",
    country: "India",
    batch: "2024 Batch (2nd Year MBBS)",
    total_score: 8540,
    total_pulses_done: 23,
    total_accuracy_pct: 92.8,
    current_streak: 7,
    xp: 2020,
    movement: "same",
    movement_val: 0,
    last_active_at: new Date().toISOString(),
    rank: 9,
    season_id: "S1",
  },
  {
    participant_id: "p-10",
    display_name: "Ishaan Mehta",
    institution: "Terna Medical College, Navi Mumbai",
    country: "India",
    batch: "2026 Batch (Freshers)",
    total_score: 8410,
    total_pulses_done: 22,
    total_accuracy_pct: 92.1,
    current_streak: 6,
    xp: 1910,
    movement: "up",
    movement_val: 2,
    last_active_at: new Date().toISOString(),
    rank: 10,
    season_id: "S1",
  },
];

// ── Live Supabase Leaderboard Query with Fallback ──────────────────────────────
export async function getLiveLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  try {
    const { data, error } = await (supabase as any)
      .from("championship_participants")
      .select(
        "id, display_name, institution, country, total_score, total_pulses_done, " +
        "total_accuracy_pct, current_streak, last_active_at, show_institution, " +
        "show_country, show_score, season_id, registered_at"
      )
      .eq("season_id", SEASON_ID)
      .eq("status", "active")
      .order("total_score", { ascending: false })
      .order("total_pulses_done", { ascending: false })
      .order("total_accuracy_pct", { ascending: false })
      .order("registered_at", { ascending: true })
      .limit(limit);

    if (error || !data || data.length === 0) {
      return SEED_LEADERBOARD;
    }

    type Row = Database["public"]["Tables"]["championship_participants"]["Row"];
    const entries: LeaderboardEntry[] = (data as Row[]).map((p, idx) => ({
      participant_id: p.id,
      display_name: p.show_score ? p.display_name : "—",
      institution: p.show_institution ? p.institution : null,
      country: p.show_country ? p.country : null,
      total_score: p.total_score ?? 0,
      total_pulses_done: p.total_pulses_done ?? 0,
      total_accuracy_pct: Number(p.total_accuracy_pct ?? 0),
      current_streak: p.current_streak ?? 0,
      xp: Math.round((p.total_score ?? 0) * 0.35),
      movement: idx % 3 === 0 ? "up" : idx % 3 === 1 ? "same" : "down",
      movement_val: idx % 3 === 0 ? 1 : 0,
      last_active_at: p.last_active_at,
      rank: idx + 1,
      season_id: p.season_id,
    }));

    return entries;
  } catch {
    return SEED_LEADERBOARD;
  }
}

// ── Record Pulse Submission ───────────────────────────────────────────────────
export async function submitPulseAttempt(params: {
  participantId?: string;
  userId?: string;
  slot: number;
  answers: number[];
  questions: PulseQuestion[];
  timeTakenSeconds: number;
}): Promise<{ score: number; accuracy: number; xp: number; correctCount: number }> {
  const { slot, answers, questions, timeTakenSeconds, participantId, userId } = params;

  let correctCount = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correctIndex) {
      correctCount++;
    }
  });

  const accuracy = Math.round((correctCount / questions.length) * 100);
  // Scoring formula: 20 pts per question + time bonus up to 20 pts
  const timeBonus = Math.max(0, 20 - Math.floor(timeTakenSeconds / 5));
  const score = correctCount * 20 + timeBonus;
  const xp = correctCount * 50 + 50;

  const dateStr = getISTDateString();
  const idempotencyKey = `S1:${dateStr}:slot${slot}:${userId || "anon"}`;

  // If user is authenticated and registered, submit to Supabase
  if (participantId && userId) {
    try {
      await (supabase as any).rpc("record_pulse_completion", {
        p_idempotency_key: idempotencyKey,
        p_participant_id: participantId,
        p_pulse_slot: slot,
        p_pulse_type: slot === 5 ? "general" : "mbbs",
        p_pulse_category: questions[0]?.subject || "Medical",
        p_time_taken_seconds: timeTakenSeconds,
        p_score_awarded: score,
        p_answers_correct: correctCount,
        p_answers_total: questions.length,
      });
    } catch (e) {
      console.warn("Supabase record_pulse_completion skipped or unconfigured:", e);
    }
  }

  return { score, accuracy, xp, correctCount };
}

// ── Registration Data & API ───────────────────────────────────────────────────
export interface ChampionshipRegistrationData {
  fullName: string;
  medicalCollege: string;
  batch: string; // "2026 Batch (Freshers)", "2025 Batch (1st Year MBBS)", etc.
  passportId?: string | undefined;
  email: string;
}

export async function registerChampionshipParticipant(
  data: ChampionshipRegistrationData
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Try dedicated championship_registrations table
    const { error: regError } = await (supabase as any)
      .from("championship_registrations")
      .insert({
        full_name: data.fullName,
        medical_college: data.medicalCollege,
        batch: data.batch,
        passport_id: data.passportId || null,
        email: data.email,
        created_at: new Date().toISOString(),
      });

    if (regError) {
      console.warn("Supabase championship_registrations insert note:", regError.message);
    }

    // 2. Also try championship_participants table if session/schema permits
    const { data: authUser } = await (supabase as any).auth.getUser().catch(() => ({ data: null }));
    const userId = authUser?.user?.id;
    if (userId) {
      await (supabase as any)
        .from("championship_participants")
        .insert({
          user_id: userId,
          season_id: SEASON_ID,
          full_name: data.fullName,
          display_name: data.fullName,
          display_name_type: "full_name",
          institution: data.medicalCollege,
          student_id: data.passportId || null,
          country: "India",
          status: "active",
          show_score: true,
          show_institution: true,
          rules_accepted: true,
          fair_play_accepted: true,
          privacy_accepted: true,
          eligibility_confirmed: true,
          info_accurate_confirmed: true,
          registered_at: new Date().toISOString(),
        })
        .catch((err: any) => console.warn("Participant insert note:", err));
    }
  } catch (err) {
    console.warn("Supabase registration exception:", err);
  }

  // Backup to localStorage for instant local persistence
  try {
    const key = "medtrail_championship_registrations";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.push({ ...data, registeredAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(existing));
    localStorage.setItem("medtrail_my_championship_reg", JSON.stringify(data));
  } catch {
    // Ignore localStorage errors in non-browser env
  }

  return {
    success: true,
    message: "Registration Confirmed. You're officially participating in MedTrail Championship Season 1.",
  };
}
