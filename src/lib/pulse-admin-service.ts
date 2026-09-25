import { supabase } from "@/integrations/supabase/client";
import { getISTDateString, type PulseQuestion } from "@/lib/championship-service";

export type PulseSubject =
  | "Anatomy"
  | "Physiology"
  | "Biochemistry"
  | "Pathology"
  | "Pharmacology"
  | "Microbiology"
  | "General";

export type PulseDifficulty = "Easy" | "Medium" | "Hard";
export type PulseCorrectAnswer = "A" | "B" | "C" | "D";

export interface PulseQuestionInput {
  slot: number; // 1 to 5
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: PulseCorrectAnswer;
  explanation: string;
  subject: PulseSubject;
  difficulty: PulseDifficulty;
  xp_value: number;
}

export interface PulseSetRecord {
  id: string;
  pulse_date: string; // YYYY-MM-DD
  status: "draft" | "published";
  questions: PulseQuestionInput[];
  published_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PulseAttemptRecord {
  id: string;
  pulse_date: string;
  user_id: string;
  score: number;
  xp_earned: number;
  accuracy: number;
  answers: number[]; // chosen indices 0..3
  completed_at: string;
}

const LOCAL_STORAGE_PULSE_SETS_KEY = "medtrail_admin_pulse_sets";
const LOCAL_STORAGE_ATTEMPTS_PREFIX = "medtrail_pulse_attempt_";

export const DEFAULT_PULSE_SUBJECTS: PulseSubject[] = [
  "Anatomy",
  "Physiology",
  "Biochemistry",
  "Pathology",
  "Pharmacology",
  "Microbiology",
  "General",
];

export const DEFAULT_DIFFICULTIES: PulseDifficulty[] = ["Easy", "Medium", "Hard"];

/**
 * Creates an empty template for exactly 5 questions
 */
export function createEmptyPulseQuestions(): PulseQuestionInput[] {
  const subjects: PulseSubject[] = [
    "Anatomy",
    "Physiology",
    "Pharmacology",
    "Pathology",
    "General",
  ];

  return [1, 2, 3, 4, 5].map((slot) => ({
    slot,
    question: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_answer: "A",
    explanation: "",
    subject: subjects[slot - 1] || "General",
    difficulty: slot === 5 ? "Easy" : "Medium",
    xp_value: 50,
  }));
}

/**
 * Fetch pulse set for a specific date (Admin view: can see draft or published)
 */
export async function fetchPulseSetForDate(pulseDate: string): Promise<PulseSetRecord | null> {
  try {
    const { data, error } = await supabase
      .from("championship_pulse_sets")
      .select("*")
      .eq("pulse_date", pulseDate)
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        pulse_date: data.pulse_date,
        status: data.status as "draft" | "published",
        questions: (data.questions as any) || [],
        published_at: data.published_at,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    }
  } catch (err) {
    console.warn("Supabase pulse set fetch note:", err);
  }

  // Local fallback
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_PULSE_SETS_KEY) || "{}");
    if (local[pulseDate]) {
      return local[pulseDate];
    }
  } catch {
    // Ignore localStorage parse error
  }

  return null;
}

/**
 * Fetch published pulse for students for a specific date (Only published sets)
 * Do not generate questions automatically. All Pulse content must come from the admin-created database.
 */
export async function fetchTodayPublishedPulse(
  pulseDate: string = getISTDateString()
): Promise<PulseSetRecord | null> {
  try {
    const { data, error } = await supabase
      .from("championship_pulse_sets")
      .select("*")
      .eq("pulse_date", pulseDate)
      .eq("status", "published")
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        pulse_date: data.pulse_date,
        status: "published",
        questions: (data.questions as any) || [],
        published_at: data.published_at,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    }
  } catch (err) {
    console.warn("Supabase published pulse fetch note:", err);
  }

  // Local storage fallback for admin published pulse
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_PULSE_SETS_KEY) || "{}");
    const set = local[pulseDate];
    if (set && set.status === "published") {
      return set;
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Convert PulseQuestionInput array into PulseQuestion array for the quiz runner
 */
export function convertToQuizQuestions(questions: PulseQuestionInput[]): PulseQuestion[] {
  const answerMap: Record<PulseCorrectAnswer, number> = { A: 0, B: 1, C: 2, D: 3 };

  return questions.map((q, idx) => ({
    id: `pulse-admin-${q.slot || idx + 1}`,
    slot: q.slot || idx + 1,
    subject: q.subject,
    category: q.subject === "General" ? "General Pulse" : "1st MBBS",
    question: q.question,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    correctIndex: answerMap[q.correct_answer] ?? 0,
    explanation: q.explanation,
    xp: q.xp_value || 50,
    points: q.xp_value || 50,
  }));
}

/**
 * Save Pulse as Draft (Admin only)
 */
export async function savePulseDraft(
  pulseDate: string,
  questions: PulseQuestionInput[]
): Promise<{ success: boolean; data?: PulseSetRecord; error?: string }> {
  try {
    // Ensure exactly 5 questions with slots 1..5
    const cleanQuestions = questions.slice(0, 5).map((q, idx) => ({
      ...q,
      slot: idx + 1,
      xp_value: Number(q.xp_value) || 50,
    }));

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("championship_pulse_sets")
      .upsert(
        {
          pulse_date: pulseDate,
          status: "draft",
          questions: cleanQuestions as any,
          updated_at: now,
        },
        { onConflict: "pulse_date" }
      )
      .select()
      .single();

    const resultRecord: PulseSetRecord = {
      id: data?.id || `draft-${pulseDate}`,
      pulse_date: pulseDate,
      status: "draft",
      questions: cleanQuestions,
      published_at: null,
      updated_at: now,
      created_at: now,
    };

    // Backup to localStorage
    try {
      const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_PULSE_SETS_KEY) || "{}");
      local[pulseDate] = resultRecord;
      localStorage.setItem(LOCAL_STORAGE_PULSE_SETS_KEY, JSON.stringify(local));
    } catch {
      // Ignore
    }

    if (error) {
      console.warn("Supabase draft save error (saved locally):", error.message);
    }

    return { success: true, data: resultRecord };
  } catch (err: any) {
    console.error("Save draft exception:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Publish Today's Pulse (Admin only)
 * Rule: Only one Pulse set can be published per day.
 * Must validate that all 5 questions are complete.
 */
export async function publishTodayPulse(
  pulseDate: string,
  questions: PulseQuestionInput[]
): Promise<{ success: boolean; data?: PulseSetRecord; error?: string }> {
  // 1. Validation: Exactly 5 questions required
  if (questions.length !== 5) {
    return {
      success: false,
      error: `Today's Pulse must have exactly 5 questions (currently has ${questions.length}).`,
    };
  }

  // 2. Validate every question has complete fields
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const num = i + 1;
    if (!q.question.trim()) {
      return { success: false, error: `Question ${num} is missing question text.` };
    }
    if (!q.option_a.trim() || !q.option_b.trim() || !q.option_c.trim() || !q.option_d.trim()) {
      return { success: false, error: `Question ${num} must have all 4 options (A, B, C, D) filled.` };
    }
    if (!q.explanation.trim()) {
      return { success: false, error: `Question ${num} must have an explanation for students.` };
    }
    if (!q.correct_answer || !["A", "B", "C", "D"].includes(q.correct_answer)) {
      return { success: false, error: `Question ${num} must have a valid correct answer (A, B, C, or D).` };
    }
  }

  const cleanQuestions = questions.slice(0, 5).map((q, idx) => ({
    ...q,
    slot: idx + 1,
    xp_value: Number(q.xp_value) || 50,
  }));

  const now = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("championship_pulse_sets")
      .upsert(
        {
          pulse_date: pulseDate,
          status: "published",
          questions: cleanQuestions as any,
          published_at: now,
          updated_at: now,
        },
        { onConflict: "pulse_date" }
      )
      .select()
      .single();

    const record: PulseSetRecord = {
      id: data?.id || `pub-${pulseDate}`,
      pulse_date: pulseDate,
      status: "published",
      questions: cleanQuestions,
      published_at: now,
      updated_at: now,
      created_at: now,
    };

    // Save to local cache
    try {
      const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_PULSE_SETS_KEY) || "{}");
      local[pulseDate] = record;
      localStorage.setItem(LOCAL_STORAGE_PULSE_SETS_KEY, JSON.stringify(local));
    } catch {
      // Ignore
    }

    if (error) {
      console.warn("Supabase publish notice (saved locally):", error.message);
    }

    return { success: true, data: record };
  } catch (err: any) {
    console.error("Publish pulse exception:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Check if the student has already attempted today's pulse
 * Rule: Students can only attempt the published Pulse once per day.
 */
export async function checkStudentAttempt(
  pulseDate: string,
  userId?: string | null
): Promise<PulseAttemptRecord | null> {
  // Check local storage first for instant feedback
  try {
    const local = localStorage.getItem(`${LOCAL_STORAGE_ATTEMPTS_PREFIX}${pulseDate}`);
    if (local) {
      return JSON.parse(local);
    }
  } catch {
    // Ignore
  }

  // Check Supabase if user is logged in
  if (userId) {
    try {
      const { data, error } = await supabase
        .from("championship_pulse_attempts")
        .select("*")
        .eq("pulse_date", pulseDate)
        .eq("user_id", userId)
        .maybeSingle();

      if (!error && data) {
        return {
          id: data.id,
          pulse_date: data.pulse_date,
          user_id: data.user_id,
          score: data.score,
          xp_earned: data.xp_earned,
          accuracy: Number(data.accuracy),
          answers: (data.answers as any) || [],
          completed_at: data.completed_at,
        };
      }
    } catch (err) {
      console.warn("Supabase attempt check note:", err);
    }
  }

  return null;
}

/**
 * Record student's completed pulse attempt
 */
export async function recordStudentAttempt(params: {
  pulseDate: string;
  userId?: string | null;
  score: number;
  xpEarned: number;
  accuracy: number;
  answers: number[];
}): Promise<PulseAttemptRecord> {
  const now = new Date().toISOString();
  const attemptRecord: PulseAttemptRecord = {
    id: `attempt-${params.pulseDate}-${Date.now()}`,
    pulse_date: params.pulseDate,
    user_id: params.userId || "guest",
    score: params.score,
    xp_earned: params.xpEarned,
    accuracy: params.accuracy,
    answers: params.answers,
    completed_at: now,
  };

  // 1. Save to localStorage immediately
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_ATTEMPTS_PREFIX}${params.pulseDate}`,
      JSON.stringify(attemptRecord)
    );
  } catch {
    // Ignore
  }

  // 2. Save to Supabase if user is authenticated
  if (params.userId) {
    try {
      await supabase.from("championship_pulse_attempts").insert({
        pulse_date: params.pulseDate,
        user_id: params.userId,
        score: params.score,
        xp_earned: params.xpEarned,
        accuracy: params.accuracy,
        answers: params.answers as any,
        completed_at: now,
      });
    } catch (err) {
      console.warn("Supabase attempt record note:", err);
    }
  }

  return attemptRecord;
}
