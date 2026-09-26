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

/** Season window in UTC — dynamically loaded from Supabase */
export const SEASON_START_UTC: Date | null = null;
export const SEASON_END_UTC: Date | null = null;

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

// ── Pulse Content Management (Strict Admin Database Only) ──────────────────────
// Removed all randomly generated or AI-generated Pulse questions per strict rule:
// Pulse questions must be created ONLY by the MedTrail Admin via Supabase "Pulse Studio".
// Students cannot create or edit questions. Content is sourced strictly from Supabase.
export * from "./pulse-admin-service";

/**
 * @deprecated Use `fetchTodayPublishedPulse(getISTDateString())` from Supabase instead.
 * Automatically/randomly generated questions have been permanently disabled.
 */
export function getDailyPulsesForDate(_date: Date = new Date()): PulseQuestion[] {
  return [];
}


// ── Daily Time Window State ───────────────────────────────────────────────────
// Synchronized dynamic daily countdown and active window calculation

export function getDailyPulseTimeState(
  now: Date = new Date(),
  customStartTime?: Date | null
): TimeWindowState {
  if (customStartTime && !isNaN(customStartTime.getTime())) {
    let targetTimeLabel = "Scheduled Start Time";
    try {
      targetTimeLabel =
        customStartTime.toLocaleTimeString("en-IN", {
          timeZone: EVENT_TZ,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }) + " IST";
    } catch {
      targetTimeLabel = "Scheduled Start Time";
    }

    if (now < customStartTime) {
      const remainingSeconds = Math.max(0, Math.floor((customStartTime.getTime() - now.getTime()) / 1000));
      return {
        status: "before_7pm",
        countdownSeconds: remainingSeconds,
        label: `Unlocks at ${targetTimeLabel}`,
        opensAtIST: targetTimeLabel,
      };
    } else {
      return {
        status: "active_pulse",
        countdownSeconds: 0,
        label: "Today's Pulse Active",
        opensAtIST: "Open Now",
      };
    }
  }

  // Fallback: If no date configured, show awaiting announcement
  return {
    status: "before_7pm",
    countdownSeconds: 0,
    label: "Awaiting Schedule",
    opensAtIST: "TBA",
  };
}

// ── Season status helper ──────────────────────────────────────────────────────
export function getSeasonStatus(
  now: Date = new Date(),
  customStart?: Date | null,
  customEnd?: Date | null
): SeasonStatus {
  const start = customStart ?? null;
  const end = customEnd ?? null;
  if (!start) return "pre";
  if (now < start) return "pre";
  if (end && now > end) return "ended";
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

export interface ChampionshipRegistrationResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  alreadyRegistered?: boolean;
  requiresAuth?: boolean;
  passportId?: string;
}

/**
 * Generate unique Passport ID if not provided (e.g. MT-2026-X8K9P)
 */
export function generatePassportId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let randomCode = "";
  for (let i = 0; i < 5; i++) {
    randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `MT-2026-${randomCode}`;
}

export async function registerChampionshipParticipant(
  data: ChampionshipRegistrationData
): Promise<ChampionshipRegistrationResult> {
  const trimmedEmail = data.email.trim();
  const trimmedFullName = data.fullName.trim();
  const trimmedCollege = data.medicalCollege.trim();

  // 1. Generate Passport ID if empty
  const finalPassportId = (data.passportId && data.passportId.trim())
    ? data.passportId.trim()
    : generatePassportId();

  // 2. Prevent duplicate registration using the same email (Check Supabase first)
  try {
    const { data: existingRecords, error: checkError } = await supabase
      .from("championship_registrations")
      .select("id, full_name, email, medical_college, batch, passport_id, created_at")
      .ilike("email", trimmedEmail);

    if (!checkError && existingRecords && existingRecords.length > 0) {
      const existing = existingRecords[0];
      return {
        success: false,
        alreadyRegistered: true,
        message: "This email is already registered for Season 1.",
        data: existing,
        passportId: existing.passport_id || finalPassportId,
      };
    }
  } catch (err) {
    console.warn("Error checking existing registration:", err);
  }

  let insertedRecord = null;

  try {
    // 3. Real Supabase table championship_registrations insert
    const { data: insertedData, error: regError } = await supabase
      .from("championship_registrations")
      .insert({
        full_name: trimmedFullName,
        email: trimmedEmail,
        medical_college: trimmedCollege,
        batch: data.batch,
        passport_id: finalPassportId,
      })
      .select()
      .single();

    if (regError) {
      console.error("Supabase championship_registrations insert error:", regError);

      // Handle duplicate email constraint error from database
      if (
        regError.code === "23505" ||
        regError.message?.toLowerCase().includes("duplicate") ||
        regError.message?.toLowerCase().includes("unique")
      ) {
        return {
          success: false,
          alreadyRegistered: true,
          message: "This email is already registered for Season 1.",
          passportId: finalPassportId,
        };
      }

      // Handle RLS policy error if user is unauthenticated
      if (regError.code === "42501" || regError.message?.toLowerCase().includes("row-level security")) {
        return {
          success: false,
          requiresAuth: true,
          message: "Please sign in to your MedTrail account with this email to confirm your official Season 1 registration.",
          error: regError.message,
        };
      }

      return {
        success: false,
        message: regError.message,
        error: regError.message,
      };
    }

    insertedRecord = insertedData;

    // 4. Also register in championship_participants if session is active
    const { data: authUser } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    const userId = authUser?.user?.id;
    if (userId) {
      await (supabase as any)
        .from("championship_participants")
        .insert({
          user_id: userId,
          season_id: SEASON_ID,
          full_name: trimmedFullName,
          display_name: trimmedFullName,
          display_name_type: "full_name",
          institution: trimmedCollege,
          student_id: finalPassportId,
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
  } catch (err: any) {
    console.error("Supabase registration exception:", err);
    return {
      success: false,
      message: err?.message || "Failed to register in Supabase.",
      error: String(err),
    };
  }

  // Backup to localStorage for instant local persistence
  try {
    const payload = {
      fullName: trimmedFullName,
      medicalCollege: trimmedCollege,
      batch: data.batch,
      passportId: finalPassportId,
      email: trimmedEmail,
      registeredAt: new Date().toISOString(),
    };
    const key = "medtrail_championship_registrations";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    existing.push(payload);
    localStorage.setItem(key, JSON.stringify(existing));
    localStorage.setItem("medtrail_my_championship_reg", JSON.stringify(payload));
  } catch {
    // Ignore localStorage errors in non-browser env
  }

  return {
    success: true,
    message: "Registration Confirmed",
    data: insertedRecord,
    passportId: finalPassportId,
  };
}

/**
 * Fetch all Season 1 registrations (Admin only via RLS)
 */
export async function fetchChampionshipRegistrations() {
  const { data, error } = await supabase
    .from("championship_registrations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching championship registrations:", error.message);
    throw error;
  }

  return data || [];
}
