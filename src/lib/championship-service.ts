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
  time_limit_seconds?: number;
}

export const DEFAULT_PULSE_TIMER_SECONDS = 60;

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
export const SEED_LEADERBOARD: LeaderboardEntry[] = [];

// ── Live Supabase Leaderboard Query with Fallback ──────────────────────────────
export async function getLiveLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  try {
    const { fetchLeaderboardForCurrentPulse } = await import("./leaderboard-engine");
    const result = await fetchLeaderboardForCurrentPulse(limit);
    return result.entries.map((e) => ({
      participant_id: e.user_id,
      display_name: e.student_name,
      institution: e.college,
      country: "India",
      batch: e.batch,
      total_score: e.total_score,
      total_pulses_done: 1,
      total_accuracy_pct: e.accuracy,
      current_streak: 1,
      xp: e.xp,
      movement: "same" as const,
      movement_val: 0,
      last_active_at: e.submitted_at || new Date().toISOString(),
      rank: e.rank,
      season_id: "S1",
    }));
  } catch {
    return [];
  }
}

// ── Check if Student has Already Submitted Attempt for Current Pulse ─────────────
export async function fetchStudentExistingAttempt(params: {
  userId?: string | null;
  userEmail?: string | null;
  pulseId?: string | null;
  pulseDate?: string | null;
}): Promise<{ hasSubmitted: boolean; attempt?: any }> {
  const { userId, userEmail, pulseId, pulseDate } = params;
  if (!userId && !userEmail) {
    return { hasSubmitted: false };
  }

  try {
    let query = (supabase as any)
      .from("championship_pulse_attempts")
      .select("*");

    // Match pulse identity
    if (pulseId && pulseDate) {
      query = query.or(`pulse_id.eq.${pulseId},pulse_date.eq.${pulseDate}`);
    } else if (pulseId) {
      query = query.or(`pulse_id.eq.${pulseId},pulse_date.eq.${pulseId}`);
    } else if (pulseDate) {
      query = query.eq("pulse_date", pulseDate);
    }

    // Match student identity
    const conditions: string[] = [];
    if (userId) conditions.push(`user_id.eq.${userId}`);
    if (userEmail) conditions.push(`user_email.ilike.${userEmail.trim()}`);

    if (conditions.length > 0) {
      query = query.or(conditions.join(","));
    }

    const { data, error } = await query.order("completed_at", { ascending: false }).limit(1);

    if (!error && data && data.length > 0) {
      const existing = data[0];
      // Mirror to localStorage for offline cache
      if (typeof window !== "undefined") {
        try {
          const key = `${pulseDate || getISTDateString()}_${userId || userEmail}`;
          const raw = localStorage.getItem("medtrail_pulse_attempts_v2") || "{}";
          const parsed = JSON.parse(raw);
          parsed[key] = existing;
          localStorage.setItem("medtrail_pulse_attempts_v2", JSON.stringify(parsed));
        } catch {}
      }
      return { hasSubmitted: true, attempt: existing };
    }
  } catch (err) {
    console.warn("[ChampionshipService] fetchStudentExistingAttempt error:", err);
  }

  // Check localStorage backup
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("medtrail_pulse_attempts_v2");
      if (raw) {
        const parsed = JSON.parse(raw);
        const targetDate = pulseDate || getISTDateString();
        const key = `${targetDate}_${userId || userEmail}`;
        const local = parsed[key];
        if (local) {
          return { hasSubmitted: true, attempt: local };
        }
      }
    } catch {}
  }

  return { hasSubmitted: false };
}

// ── Atomic Pulse Submission (One Attempt Only + Standings Recalculation) ────────
export async function submitPulseAttemptAtomic(params: {
  pulseId: string;
  pulseDate?: string;
  userId: string;
  userEmail?: string | null;
  studentName: string;
  college: string;
  collegeId?: string | null | undefined;
  batch: string;
  answers: number[];
  questions: PulseQuestion[];
  timeTakenSeconds: number;
}): Promise<{
  success: boolean;
  alreadySubmitted: boolean;
  score: number;
  accuracy: number;
  xp: number;
  correctCount: number;
  attemptId?: string;
  message?: string;
}> {
  const {
    pulseId,
    pulseDate = getISTDateString(),
    userId,
    userEmail,
    studentName,
    college,
    collegeId,
    batch,
    answers,
    questions,
    timeTakenSeconds,
  } = params;

  const cleanAnswers = Array.isArray(answers)
    ? answers.map((a) =>
        typeof a === "number" && !Number.isNaN(a)
          ? Math.floor(a)
          : -1
      )
    : [];

  let correctCount = 0;
  questions.forEach((q, i) => {
    if (cleanAnswers[i] === q.correctIndex) {
      correctCount++;
    }
  });

  const accuracy = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  // Scoring formula: 20 pts per question + time bonus up to 20 pts
  const timeBonus = Math.max(0, 20 - Math.floor(timeTakenSeconds / 5));
  const score = correctCount * 20 + timeBonus;
  const xp = correctCount * 50 + 50;

  // 1. Attempt atomic submission via database RPC function
  try {
    const { data: rpcData, error: rpcError } = await (supabase as any).rpc(
      "submit_pulse_attempt_atomic",
      {
        p_pulse_id: pulseId,
        p_pulse_date: pulseDate,
        p_user_id: userId,
        p_user_email: userEmail || null,
        p_student_name: studentName || "Doctor",
        p_college: college || "Medical College",
        p_batch: batch || "2026 Batch → Freshers",
        p_score: score,
        p_accuracy: accuracy,
        p_time_taken_seconds: timeTakenSeconds,
        p_xp: xp,
        p_answers: cleanAnswers,
        p_college_id: collegeId || null,
      }
    );

    console.log("[PULSE RPC RETURN]", {
      success: rpcData?.success,
      alreadySubmitted: rpcData?.already_submitted,
      attemptId: rpcData?.attempt_id,
      rpcErrorCode: rpcError?.code,
      rpcErrorMessage: rpcError?.message,
    });

    if (!rpcError && rpcData) {
      if (rpcData.already_submitted) {
        return {
          success: false,
          alreadySubmitted: true,
          score,
          accuracy,
          xp,
          correctCount,
          attemptId: rpcData.attempt_id,
          message: "You have already submitted this Pulse.",
        };
      }

      return {
        success: true,
        alreadySubmitted: false,
        score,
        accuracy,
        xp,
        correctCount,
        attemptId: rpcData.attempt_id,
        message: "Attempt submitted successfully.",
      };
    }

    if (rpcError) {
      console.error("[ChampionshipService] submit_pulse_attempt_atomic RPC error:", {
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
        hint: rpcError.hint,
      });
      // Unique violation / already submitted
      if (
        rpcError.code === "23505" ||
        rpcError.message?.toLowerCase().includes("unique") ||
        rpcError.message?.toLowerCase().includes("already")
      ) {
        return {
          success: false,
          alreadySubmitted: true,
          score,
          accuracy,
          xp,
          correctCount,
          message: "You have already submitted this Pulse.",
        };
      }
      // Any other RPC error: return immediately — do NOT fall through to the fallback INSERT.
      // Falling through would mask the real error and attempt a second failing DB call.
      return {
        success: false,
        alreadySubmitted: false,
        score,
        accuracy,
        xp,
        correctCount,
        message: rpcError.message || "Pulse submission failed",
      };
    }
  } catch (err: any) {
    console.error("[ChampionshipService] submit_pulse_attempt_atomic exception:", {
      userId,
      pulseId,
      pulseDate,
      errName: err?.name,
      errMessage: err?.message,
    });
    return {
      success: false,
      alreadySubmitted: false,
      score,
      accuracy,
      xp,
      correctCount,
      message: err?.message || "Pulse submission failed",
    };
  }

  // 2. Direct Fallback insert into championship_pulse_attempts (stores all 8 permanent fields)
  try {
    const submittedAt = new Date().toISOString();
    const { data: insertData, error: insertError } = await (supabase as any)
      .from("championship_pulse_attempts")
      .insert({
        pulse_id: pulseId,
        pulse_date: pulseDate,
        user_id: userId,
        user_email: userEmail || null,
        student_name: studentName || "Doctor",
        college: college || "Medical College",
        batch: batch || "2026 Batch → Freshers",
        score,
        accuracy,
        time_taken_seconds: timeTakenSeconds,
        completion_time: timeTakenSeconds,
        submitted_at: submittedAt,
        completed_at: submittedAt,
        xp,
        answers,
      })
      .select()
      .single();

    if (insertError) {
      if (
        insertError.code === "23505" ||
        insertError.message?.toLowerCase().includes("unique") ||
        insertError.message?.toLowerCase().includes("already")
      ) {
        return {
          success: false,
          alreadySubmitted: true,
          score,
          accuracy,
          xp,
          correctCount,
          message: "You have already submitted this Pulse.",
        };
      }
      throw insertError;
    }

    return {
      success: true,
      alreadySubmitted: false,
      score,
      accuracy,
      xp,
      correctCount,
      attemptId: insertData?.id,
      message: "Attempt submitted successfully.",
    };
  } catch (err: any) {
    console.error("[ChampionshipService] Fallback insert attempt error:", err);
    return {
      success: false,
      alreadySubmitted: false,
      score,
      accuracy,
      xp,
      correctCount,
      message: err?.message || "Failed to submit attempt.",
    };
  }
}

// ── Legacy Record Pulse Submission (Maintained for Backward Compatibility) ─────
export async function submitPulseAttempt(params: {
  participantId?: string;
  userId?: string;
  slot: number;
  answers: number[];
  questions: PulseQuestion[];
  timeTakenSeconds: number;
}): Promise<{ score: number; accuracy: number; xp: number; correctCount: number }> {
  const { answers, questions, timeTakenSeconds } = params;

  let correctCount = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correctIndex) {
      correctCount++;
    }
  });

  const accuracy = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  const timeBonus = Math.max(0, 20 - Math.floor(timeTakenSeconds / 5));
  const score = correctCount * 20 + timeBonus;
  const xp = correctCount * 50 + 50;

  return { score, accuracy, xp, correctCount };
}

// ── Registration Data & API ───────────────────────────────────────────────────
export interface ChampionshipRegistrationData {
  fullName: string;
  medicalCollege: string;
  medicalCollegeId?: string | null | undefined;
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
  const collegeId = data.medicalCollegeId || null;

  // 1. Generate Passport ID if empty
  const finalPassportId = (data.passportId && data.passportId.trim())
    ? data.passportId.trim()
    : generatePassportId();

  // 2. Prevent duplicate registration using the same email (Check Supabase first)
  try {
    const { data: existingRecords, error: checkError } = await supabase
      .from("championship_registrations")
      .select("id, full_name, email, medical_college, batch, passport_id, created_at, medical_college_id")
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
        medical_college_id: collegeId,
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

    // 4. Update student's profile with medical_college_id if logged in
    const { data: authUser } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    const userId = authUser?.user?.id;
    if (userId) {
      await supabase
        .from("profiles")
        .update({
          medical_college_id: collegeId,
        })
        .eq("id", userId)
        .catch((profErr: any) => console.warn("Profile college update note:", profErr));

      // Also register in championship_participants if table exists
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
      medicalCollegeId: collegeId,
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
