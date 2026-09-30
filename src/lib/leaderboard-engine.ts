import { supabase } from "@/integrations/supabase/client";

export interface LeaderboardStudentEntry {
  rank: number;
  participant_id: string;
  display_name: string;
  institution: string;
  batch: string;
  score: number;
  total_score: number;
  correct_answers: number;
  wrong_answers: number;
  accuracy: number;
  time_taken_seconds: number;
  submitted_at: string;
  is_current_user?: boolean;
}

export interface DynamicCollegeRankItem {
  rank: number;
  name: string;
  college: string;
  collegeName: string;
  medicalCollegeId?: string;
  city?: string;
  activeStudents: number;
  participantsCount: number;
  avgScore: number;
  avgAccuracy: string;
  totalScore: number;
  topScorer: string;
  movement?: string;
}

export interface DynamicBatchRankItem {
  rank: number;
  batch: string;
  batchName: string;
  batchYear: string;
  enrolled: number;
  participantsCount: number;
  totalScore: number;
  avgScore: number;
  avgAccuracy: string;
  pulseCompletionRate: string;
}

export interface LeaderboardCalculationResult {
  entries: LeaderboardStudentEntry[];
  currentUserEntry?: LeaderboardStudentEntry | null;
  collegeRankings: DynamicCollegeRankItem[];
  batchRankings: DynamicBatchRankItem[];
  pulseSetId: string | null;
  pulseDate: string | null;
}

/**
 * Standard 4-Tier Sorting for MedTrail Leaderboard (maintained for export compatibility):
 * 1. Highest Score (score DESC)
 * 2. Highest Accuracy (accuracy DESC)
 * 3. Lowest Time Taken (time_taken_seconds ASC)
 * 4. Earliest Submission (submitted_at ASC)
 */
export function compareLeaderboardEntries(
  a: { score: number; accuracy: number; time_taken_seconds: number; submitted_at: string | null },
  b: { score: number; accuracy: number; time_taken_seconds: number; submitted_at: string | null }
): number {
  const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;

  const accDiff = Number(b.accuracy ?? 0) - Number(a.accuracy ?? 0);
  if (accDiff !== 0) return accDiff;

  const timeA = Number(a.time_taken_seconds ?? 0);
  const timeB = Number(b.time_taken_seconds ?? 0);
  if (timeA !== timeB) return timeA - timeB;

  const dateA = new Date(a.submitted_at || 0).getTime();
  const dateB = new Date(b.submitted_at || 0).getTime();
  return dateA - dateB;
}

/**
 * Helper to compute correct and wrong answers (maintained for export compatibility).
 */
export function calculateAttemptMetrics(
  attempt: any,
  questions: any[]
): {
  totalScore: number;
  correctAnswers: number;
  wrongAnswers: number;
  accuracyPct: number;
  timeTaken: number;
} {
  const totalScore = Number(attempt.score ?? 0);
  const timeTaken = Number(attempt.time_taken_seconds ?? 0);
  const totalQuestions =
    questions && questions.length > 0
      ? questions.length
      : Array.isArray(attempt.answers) && attempt.answers.length > 0
      ? attempt.answers.length
      : 5;

  let correctCount = 0;
  const userAnswers = Array.isArray(attempt.answers) ? attempt.answers : [];

  if (userAnswers.length > 0 && questions && questions.length > 0) {
    userAnswers.forEach((ans: any, idx: number) => {
      const q = questions[idx];
      if (!q) return;

      let correctIdx = -1;
      if (typeof q.correctIndex === "number") {
        correctIdx = q.correctIndex;
      } else if (typeof q.correct_answer === "string") {
        const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };
        correctIdx = letterMap[q.correct_answer.trim()] ?? -1;
      }

      let userIdx = -1;
      if (typeof ans === "number") {
        userIdx = ans;
      } else if (typeof ans === "string") {
        const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };
        userIdx = letterMap[ans.trim()] ?? -1;
      } else if (ans && typeof ans === "object") {
        if (typeof ans.is_correct === "boolean") {
          if (ans.is_correct) correctCount++;
          return;
        }
        if (typeof ans.selected === "number") {
          userIdx = ans.selected;
        } else if (typeof ans.answer === "number") {
          userIdx = ans.answer;
        }
      }

      if (userIdx >= 0 && correctIdx >= 0 && userIdx === correctIdx) {
        correctCount++;
      }
    });
  } else {
    const acc = Number(attempt.accuracy ?? 0);
    correctCount = Math.round((acc / 100) * totalQuestions);
  }

  const correctAnswers = Math.min(Math.max(0, correctCount), totalQuestions);
  const wrongAnswers = Math.max(0, totalQuestions - correctAnswers);
  const accuracyPct =
    totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : Number(attempt.accuracy ?? 0);

  return {
    totalScore,
    correctAnswers,
    wrongAnswers,
    accuracyPct,
    timeTaken,
  };
}

/**
 * Fetch leaderboard strictly from SQL standings tables as the single source of truth:
 * - Public Top 5 reads ONLY from championship_leaderboard (limited to 5 for students)
 * - Admin reads complete leaderboard from championship_leaderboard
 * - Student self result reads only the logged-in user's row from championship_leaderboard
 * - College rankings read championship_college_standings
 * - MBBS batch rankings read championship_batch_standings
 * - Zero client-side ranking recalculations
 */
export async function fetchLeaderboardForCurrentPulse(params?: {
  pulseSetId?: string | null;
  pulseDate?: string | null;
  currentUserEmail?: string | null;
  currentUserId?: string | null;
  participantId?: string | null;
  isAdmin?: boolean;
}): Promise<LeaderboardCalculationResult> {
  try {
    let resolvedSetId = params?.pulseSetId || null;
    let resolvedDate = params?.pulseDate || null;

    // 1. Resolve pulse date & pulse set ID if not provided
    if (!resolvedDate) {
      try {
        const { data: pSettings } = await (supabase as any)
          .from("pulse_settings")
          .select("competition_date")
          .limit(1)
          .maybeSingle();

        if (pSettings?.competition_date) {
          resolvedDate = pSettings.competition_date;
        }
      } catch {}
    }

    if (!resolvedSetId && resolvedDate) {
      try {
        const { data: setByDate } = await (supabase as any)
          .from("championship_pulse_sets")
          .select("id")
          .eq("pulse_date", resolvedDate)
          .maybeSingle();

        if (setByDate?.id) {
          resolvedSetId = setByDate.id;
        }
      } catch {}
    }

    // Candidate pulse identifiers
    const candidatePulseIds = [
      resolvedSetId,
      resolvedDate,
      resolvedDate ? `pulse_${resolvedDate}` : null,
    ].filter(Boolean) as string[];

    const currentEmail = params?.currentUserEmail?.trim().toLowerCase();
    const currentId = params?.currentUserId?.trim();
    const partId = params?.participantId?.trim();

    // 2. Requirements 3 & 7: Query championship_leaderboard
    // Public receives ONLY Top 5. Admin receives all entries.
    let lbQuery = (supabase as any)
      .from("championship_leaderboard")
      .select("*")
      .order("rank", { ascending: true });

    if (candidatePulseIds.length > 0) {
      lbQuery = lbQuery.in("pulse_id", candidatePulseIds);
    }

    if (!params?.isAdmin) {
      lbQuery = lbQuery.limit(5);
    }

    let { data: lbData, error: lbErr } = await lbQuery;

    if (lbErr) {
      console.warn("[LeaderboardEngine] championship_leaderboard query notice:", lbErr);
    }

    // NOTE: No unfiltered fallback — if today's pulse has no submissions yet, return empty.
    // Previously this fallback returned all-time rows (e.g. "Test 1", "Test 2") which is wrong.

    // Map rows directly from SQL table
    const entries: LeaderboardStudentEntry[] = (lbData || []).map((row: any, idx: number) => {
      const isCurrentUser = Boolean(
        (currentEmail && row.user_email && row.user_email.toLowerCase() === currentEmail) ||
        (currentId && row.user_id && row.user_id === currentId) ||
        (partId && row.user_id && row.user_id === partId)
      );

      const acc = Number(row.accuracy ?? 0);
      const totalQ = 5;
      const correct = Math.min(totalQ, Math.round((acc / 100) * totalQ));
      const wrong = Math.max(0, totalQ - correct);

      return {
        rank: row.rank ?? idx + 1,
        participant_id: row.user_id || row.id,
        display_name: row.student_name || "Doctor",
        institution: row.college || "Medical College",
        batch: row.batch || "2026 Batch → Freshers",
        score: Number(row.score ?? 0),
        total_score: Number(row.score ?? 0),
        correct_answers: correct,
        wrong_answers: wrong,
        accuracy: acc,
        time_taken_seconds: Number(row.time_taken_seconds ?? 0),
        submitted_at: row.submitted_at || row.updated_at || new Date().toISOString(),
        is_current_user: isCurrentUser,
      };
    });

    // 3. Requirement 6: Student self result reads only logged-in user's row from championship_leaderboard
    let currentUserEntry: LeaderboardStudentEntry | null = entries.find((e) => e.is_current_user) || null;

    if (!currentUserEntry && (currentEmail || currentId || partId)) {
      try {
        let selfQuery = (supabase as any)
          .from("championship_leaderboard")
          .select("*");

        if (candidatePulseIds.length > 0) {
          selfQuery = selfQuery.in("pulse_id", candidatePulseIds);
        }

        const orFilters: string[] = [];
        if (currentId) orFilters.push(`user_id.eq.${currentId}`);
        if (partId && partId !== currentId) orFilters.push(`user_id.eq.${partId}`);
        if (currentEmail) orFilters.push(`user_email.ilike.${currentEmail}`);

        if (orFilters.length > 0) {
          selfQuery = selfQuery.or(orFilters.join(","));
        }

        let { data: selfRow } = await selfQuery.order("rank", { ascending: true }).limit(1).maybeSingle();

        // Fallback without pulse_id constraint if not found
        if (!selfRow && orFilters.length > 0) {
          const { data: globalSelf } = await (supabase as any)
            .from("championship_leaderboard")
            .select("*")
            .or(orFilters.join(","))
            .order("rank", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (globalSelf) {
            selfRow = globalSelf;
          }
        }

        if (selfRow) {
          const acc = Number(selfRow.accuracy ?? 0);
          const totalQ = 5;
          const correct = Math.min(totalQ, Math.round((acc / 100) * totalQ));
          const wrong = Math.max(0, totalQ - correct);

          currentUserEntry = {
            rank: selfRow.rank ?? 0,
            participant_id: selfRow.user_id || selfRow.id,
            display_name: selfRow.student_name || "Doctor",
            institution: selfRow.college || "Medical College",
            batch: selfRow.batch || "2026 Batch → Freshers",
            score: Number(selfRow.score ?? 0),
            total_score: Number(selfRow.score ?? 0),
            correct_answers: correct,
            wrong_answers: wrong,
            accuracy: acc,
            time_taken_seconds: Number(selfRow.time_taken_seconds ?? 0),
            submitted_at: selfRow.submitted_at || selfRow.updated_at || new Date().toISOString(),
            is_current_user: true,
          };
        }
      } catch (selfErr) {
        console.warn("[LeaderboardEngine] student self result fetch error:", selfErr);
      }
    }

    // 4. Requirement 4: College ranking must read championship_college_standings
    let collegeQuery = (supabase as any)
      .from("championship_college_standings")
      .select("*")
      .order("rank", { ascending: true });

    if (candidatePulseIds.length > 0) {
      collegeQuery = collegeQuery.in("pulse_id", candidatePulseIds);
    }

    let { data: collegeRows } = await collegeQuery;

    // No unfiltered college fallback — return empty if no data for today's pulse.

    const collegeRankings: DynamicCollegeRankItem[] = (collegeRows || []).map((c: any, idx: number) => ({
      rank: c.rank ?? idx + 1,
      name: c.college,
      college: c.college,
      collegeName: c.college,
      medicalCollegeId: c.medical_college_id || undefined,
      city: "Medical Institution",
      activeStudents: Number(c.participants_count ?? 0),
      participantsCount: Number(c.participants_count ?? 0),
      totalScore: Number(c.total_score ?? 0),
      avgScore: Number(c.avg_score ?? 0),
      avgAccuracy: `${Number(c.avg_accuracy ?? 0)}%`,
      topScorer: c.top_scorer || "—",
      movement: "• 0",
    }));

    // 5. Requirement 5: MBBS batch ranking must read championship_batch_standings
    let batchQuery = (supabase as any)
      .from("championship_batch_standings")
      .select("*")
      .order("rank", { ascending: true });

    if (candidatePulseIds.length > 0) {
      batchQuery = batchQuery.in("pulse_id", candidatePulseIds);
    }

    let { data: batchRows } = await batchQuery;

    // No unfiltered batch fallback — return empty if no data for today's pulse.

    const batchRankings: DynamicBatchRankItem[] = (batchRows || []).map((b: any, idx: number) => {
      const batchName = b.batch;
      const batchYear = batchName.match(/\d{4}/)?.[0] || batchName.slice(0, 4);
      return {
        rank: b.rank ?? idx + 1,
        batch: batchName,
        batchName,
        batchYear,
        enrolled: Number(b.participants_count ?? 0),
        participantsCount: Number(b.participants_count ?? 0),
        totalScore: Number(b.total_score ?? 0),
        avgScore: Number(b.avg_score ?? 0),
        avgAccuracy: `${Number(b.avg_accuracy ?? 0)}%`,
        pulseCompletionRate: "100%",
      };
    });

    return {
      entries,
      currentUserEntry,
      collegeRankings,
      batchRankings,
      pulseSetId: resolvedSetId,
      pulseDate: resolvedDate,
    };
  } catch (err) {
    console.error("[LeaderboardEngine] fetchLeaderboardForCurrentPulse error:", err);
    return {
      entries: [],
      currentUserEntry: null,
      collegeRankings: [],
      batchRankings: [],
      pulseSetId: null,
      pulseDate: null,
    };
  }
}
