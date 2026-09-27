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
  collegeRankings: DynamicCollegeRankItem[];
  batchRankings: DynamicBatchRankItem[];
  pulseSetId: string | null;
  pulseDate: string | null;
}

/**
 * Standard 4-Tier Sorting for MedTrail Leaderboard:
 * 1. Highest Score (score DESC)
 * 2. Highest Accuracy (accuracy DESC)
 * 3. Lowest Time Taken (time_taken_seconds ASC)
 * 4. Earliest Submission (submitted_at ASC)
 */
export function compareLeaderboardEntries(
  a: { score: number; accuracy: number; time_taken_seconds: number; submitted_at: string | null },
  b: { score: number; accuracy: number; time_taken_seconds: number; submitted_at: string | null }
): number {
  // 1. Highest Score
  const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;

  // 2. Highest Accuracy
  const accDiff = Number(b.accuracy ?? 0) - Number(a.accuracy ?? 0);
  if (accDiff !== 0) return accDiff;

  // 3. Lowest Time Taken
  const timeA = Number(a.time_taken_seconds ?? 0);
  const timeB = Number(b.time_taken_seconds ?? 0);
  if (timeA !== timeB) return timeA - timeB;

  // 4. Earliest Submission
  const dateA = new Date(a.submitted_at || 0).getTime();
  const dateB = new Date(b.submitted_at || 0).getTime();
  return dateA - dateB;
}

/**
 * Helper to compute correct and wrong answers from an attempt and the pulse set questions.
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

      // Extract correct option index (0..3)
      let correctIdx = -1;
      if (typeof q.correctIndex === "number") {
        correctIdx = q.correctIndex;
      } else if (typeof q.correct_answer === "string") {
        const letterMap: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };
        correctIdx = letterMap[q.correct_answer.trim()] ?? -1;
      }

      // Extract user chosen option index (0..3)
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
    // If questions or answers aren't detailed, calculate from accuracy %
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
 * Fetch dynamic leaderboard strictly from championship_pulse_attempts
 * filtered by the current pulse_set_id only.
 */
export async function fetchLeaderboardForCurrentPulse(params?: {
  pulseSetId?: string | null;
  pulseDate?: string | null;
  currentUserEmail?: string | null;
  currentUserId?: string | null;
}): Promise<LeaderboardCalculationResult> {
  try {
    let resolvedSetId = params?.pulseSetId || null;
    let resolvedDate = params?.pulseDate || null;
    let pulseQuestions: any[] = [];

    // 1. Resolve current pulse set from championship_pulse_sets
    if (resolvedSetId) {
      const { data: setById } = await (supabase as any)
        .from("championship_pulse_sets")
        .select("*")
        .eq("id", resolvedSetId)
        .maybeSingle();

      if (setById) {
        resolvedDate = setById.pulse_date;
        pulseQuestions = Array.isArray(setById.questions) ? setById.questions : [];
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(resolvedSetId)) {
        // If passed as date
        resolvedDate = resolvedSetId;
        const { data: setByDate } = await (supabase as any)
          .from("championship_pulse_sets")
          .select("*")
          .eq("pulse_date", resolvedDate)
          .maybeSingle();
        if (setByDate) {
          resolvedSetId = setByDate.id;
          pulseQuestions = Array.isArray(setByDate.questions) ? setByDate.questions : [];
        }
      }
    }

    if (!resolvedDate) {
      // Check pulse_settings single source of truth
      try {
        const { data: pSettings } = await (supabase as any)
          .from("pulse_settings")
          .select("competition_date")
          .eq("id", 1)
          .maybeSingle();

        if (pSettings?.competition_date) {
          resolvedDate = pSettings.competition_date;
        }
      } catch {}
    }

    if (!resolvedDate) {
      // Find latest published set
      const { data: latestSet } = await (supabase as any)
        .from("championship_pulse_sets")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestSet) {
        resolvedSetId = latestSet.id;
        resolvedDate = latestSet.pulse_date;
        pulseQuestions = Array.isArray(latestSet.questions) ? latestSet.questions : [];
      }
    } else if (!resolvedSetId || pulseQuestions.length === 0) {
      const { data: setByDate } = await (supabase as any)
        .from("championship_pulse_sets")
        .select("*")
        .eq("pulse_date", resolvedDate)
        .maybeSingle();

      if (setByDate) {
        resolvedSetId = setByDate.id;
        pulseQuestions = Array.isArray(setByDate.questions) ? setByDate.questions : [];
      }
    }

    // 2. Query championship_pulse_attempts strictly for the current pulse set
    let attemptsQuery = (supabase as any).from("championship_pulse_attempts").select("*");
    if (resolvedDate) {
      attemptsQuery = attemptsQuery.eq("pulse_date", resolvedDate);
    }
    const { data: rawAttempts, error: attemptsError } = await attemptsQuery;

    if (attemptsError) {
      console.warn("[LeaderboardEngine] championship_pulse_attempts query warning:", attemptsError);
    }

    let attemptsList: any[] = Array.isArray(rawAttempts) ? [...rawAttempts] : [];

    // Check localStorage for student's local attempt if client-side
    if (typeof window !== "undefined") {
      try {
        const rawLocal = localStorage.getItem("medtrail_pulse_attempts_v2");
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          Object.values(parsed).forEach((att: any) => {
            if (!att) return;
            // Match current pulse_set_id or pulse_date
            const matchesSet =
              (resolvedSetId && att.pulse_set_id === resolvedSetId) ||
              (resolvedDate && att.pulse_date === resolvedDate);
            if (matchesSet) {
              const attKey = att.user_id || att.user_email || att.id;
              const alreadyInRemote = attemptsList.some(
                (r) => (r.user_id && r.user_id === att.user_id) || (r.user_email && r.user_email === att.user_email)
              );
              if (!alreadyInRemote) {
                attemptsList.push(att);
              }
            }
          });
        }
      } catch {}
    }

    if (attemptsList.length === 0) {
      return {
        entries: [],
        collegeRankings: [],
        batchRankings: [],
        pulseSetId: resolvedSetId,
        pulseDate: resolvedDate,
      };
    }

    // 3. Enrich student registrations (Name, College, Batch)
    const emails = attemptsList.map((a) => a.user_email).filter(Boolean);
    const regMap = new Map<string, { name: string; college: string; batch: string }>();

    if (emails.length > 0) {
      try {
        const { data: regs } = await (supabase as any)
          .from("championship_registrations")
          .select("email, full_name, medical_college, batch")
          .in("email", emails);

        if (regs) {
          for (const r of regs) {
            if (r.email) {
              regMap.set(r.email.toLowerCase(), {
                name: r.full_name,
                college: r.medical_college,
                batch: r.batch,
              });
            }
          }
        }
      } catch {}
    }

    // 4. Calculate metrics for each attempt
    const processedEntries: LeaderboardStudentEntry[] = [];

    for (const a of attemptsList) {
      const email = (a.user_email || "").toLowerCase();
      const reg = email ? regMap.get(email) : null;

      const metrics = calculateAttemptMetrics(a, pulseQuestions);
      const studentName =
        a.student_name ||
        reg?.name ||
        (email ? email.split("@")[0] : `Student`);
      const institution = a.college || reg?.college || "Medical College";
      const batch = reg?.batch || a.batch || "2026 Batch → Freshers";
      const submittedAt = a.completed_at || a.created_at || new Date().toISOString();

      const isCurrentUser = Boolean(
        (params?.currentUserEmail && email && email === params.currentUserEmail.toLowerCase()) ||
        (params?.currentUserId && a.user_id && a.user_id === params.currentUserId)
      );

      processedEntries.push({
        rank: 0,
        participant_id: a.user_id || a.id || email,
        display_name: studentName,
        institution,
        batch,
        score: metrics.totalScore,
        total_score: metrics.totalScore,
        correct_answers: metrics.correctAnswers,
        wrong_answers: metrics.wrongAnswers,
        accuracy: metrics.accuracyPct,
        time_taken_seconds: metrics.timeTaken,
        submitted_at: submittedAt,
        is_current_user: isCurrentUser,
      });
    }

    // 5. Deduplicate by student identity: keep best attempt
    const studentBestMap = new Map<string, LeaderboardStudentEntry>();

    for (const entry of processedEntries) {
      const key = entry.participant_id.toLowerCase();
      const existing = studentBestMap.get(key);
      if (!existing) {
        studentBestMap.set(key, entry);
      } else {
        // Compare to keep the best attempt according to ranking order
        if (compareLeaderboardEntries(entry, existing) < 0) {
          studentBestMap.set(key, entry);
        }
      }
    }

    const uniqueEntries = Array.from(studentBestMap.values());

    // 6. Rank all entries strictly according to the 4-tier criteria:
    // 1) Highest Score
    // 2) Highest Accuracy
    // 3) Lowest time_taken_seconds
    // 4) Earliest submitted_at
    uniqueEntries.sort((a, b) => compareLeaderboardEntries(a, b));

    uniqueEntries.forEach((entry, idx) => {
      entry.rank = idx + 1;
    });

    // 7. Calculate Dynamic College Standings from actual entries
    const collegeMap = new Map<
      string,
      {
        totalScore: number;
        count: number;
        topScorer: string;
        topScore: number;
        accuracies: number[];
      }
    >();

    for (const entry of uniqueEntries) {
      const college = entry.institution || "Medical College";
      const existing = collegeMap.get(college) || {
        totalScore: 0,
        count: 0,
        topScorer: entry.display_name,
        topScore: 0,
        accuracies: [],
      };
      existing.totalScore += entry.score;
      existing.count += 1;
      existing.accuracies.push(entry.accuracy);
      if (entry.score > existing.topScore) {
        existing.topScore = entry.score;
        existing.topScorer = entry.display_name;
      }
      collegeMap.set(college, existing);
    }

    const collegeRankings: DynamicCollegeRankItem[] = Array.from(collegeMap.entries())
      .map(([name, stat]) => {
        const avgScore = stat.count > 0 ? Math.round(stat.totalScore / stat.count) : 0;
        const avgAccNum =
          stat.accuracies.length > 0
            ? Math.round(stat.accuracies.reduce((sum, v) => sum + v, 0) / stat.accuracies.length)
            : 0;
        return {
          rank: 0,
          name,
          college: name,
          collegeName: name,
          activeStudents: stat.count,
          participantsCount: stat.count,
          totalScore: stat.totalScore,
          avgScore,
          avgAccuracy: `${avgAccNum}%`,
          topScorer: stat.topScorer,
          movement: "• 0",
        };
      })
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return (parseInt(b.avgAccuracy) || 0) - (parseInt(a.avgAccuracy) || 0);
      })
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    // 8. Calculate Dynamic MBBS Batch Standings from actual entries
    const batchMap = new Map<
      string,
      {
        totalScore: number;
        count: number;
        accuracies: number[];
      }
    >();

    for (const entry of uniqueEntries) {
      let matchedBatch = "2024 Batch → 2nd Year MBBS";
      const b = entry.batch || "";
      if (b.includes("2026") || b.includes("Freshers")) matchedBatch = "2026 Batch → Freshers";
      else if (b.includes("2025") || b.includes("1st Year")) matchedBatch = "2025 Batch → 1st Year MBBS";
      else if (b.includes("2024") || b.includes("2nd Year")) matchedBatch = "2024 Batch → 2nd Year MBBS";
      else if (b.includes("2023") || b.includes("3rd Year")) matchedBatch = "2023 Batch → 3rd Year MBBS";

      const existing = batchMap.get(matchedBatch) || { totalScore: 0, count: 0, accuracies: [] };
      existing.totalScore += entry.score;
      existing.count += 1;
      existing.accuracies.push(entry.accuracy);
      batchMap.set(matchedBatch, existing);
    }

    const batchRankings: DynamicBatchRankItem[] = Array.from(batchMap.entries())
      .map(([batchName, stat]) => {
        const avgAccNum =
          stat.accuracies.length > 0
            ? Math.round(stat.accuracies.reduce((sum, v) => sum + v, 0) / stat.accuracies.length)
            : 0;
        const avgScore = stat.count > 0 ? Math.round(stat.totalScore / stat.count) : 0;
        return {
          rank: 0,
          batch: batchName,
          batchName,
          batchYear: batchName.slice(0, 4),
          enrolled: stat.count,
          participantsCount: stat.count,
          totalScore: stat.totalScore,
          avgScore,
          avgAccuracy: `${avgAccNum}%`,
          pulseCompletionRate: "100%",
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    return {
      entries: uniqueEntries,
      collegeRankings,
      batchRankings,
      pulseSetId: resolvedSetId,
      pulseDate: resolvedDate,
    };
  } catch (err) {
    console.error("[LeaderboardEngine] fetchLeaderboardForCurrentPulse error:", err);
    return {
      entries: [],
      collegeRankings: [],
      batchRankings: [],
      pulseSetId: null,
      pulseDate: null,
    };
  }
}
