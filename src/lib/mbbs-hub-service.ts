import { supabase } from "@/integrations/supabase/client";
import type {
  Profile,
  Subject,
  SubjectGoal,
  SubjectTopic,
  DailyTask,
  MonthlyGoal,
  StudyStreak,
  Exam,
  Note,
  StreakStats,
  PriorityLevel,
  ExamType,
  ExamStatus,
  TopicStatus,
  GoalStatus,
} from "@/types/mbbs-hub";

// Helper: Format date as YYYY-MM-DD
export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper: Format month as YYYY-MM
export function getCurrentMonthString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/* =========================================================================
   0. USER PROFILE
   ========================================================================= */

export async function ensureUserProfile(user: { id: string; email?: string | null; user_metadata?: any }): Promise<{ data: Profile | null; error: string | null }> {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return { data: existing, error: null };
    }

    // Insert new profile
    const fullName = user.user_metadata?.["full_name"] || user.email?.split("@")[0] || "Medical Student";
    const { data: created, error: insertErr } = await supabase
      .from("profiles")
      .insert([
        {
          user_id: user.id,
          full_name: fullName,
          email: user.email || null,
        },
      ])
      .select()
      .single();

    if (insertErr && insertErr.code !== "23505") {
      throw insertErr;
    }

    return { data: created || existing, error: null };
  } catch (err: any) {
    console.warn("[MBBSService] ensureUserProfile notice:", err?.message);
    return { data: null, error: err?.message || null };
  }
}

/* =========================================================================
   1. DAILY TASKS (CRUD + Checkbox completion with auto-streak update)
   ========================================================================= */

export async function fetchDailyTasks(
  userId: string,
  dateStr?: string
): Promise<{ data: DailyTask[]; error: string | null }> {
  try {
    const targetDate = dateStr || getTodayDateString();
    const { data: tasksData, error: taskErr } = await supabase
      .from("daily_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("task_date", targetDate)
      .order("created_at", { ascending: false });

    if (taskErr) throw taskErr;

    // Fetch subjects for joining name
    const { data: subjectsData } = await supabase.from("subjects").select("id, name").eq("user_id", userId);

    const tasks: DailyTask[] = (tasksData || []).map((task) => {
      const sub = (subjectsData || []).find((s) => s.id === task.subject_id);
      return {
        ...task,
        priority: (task.priority as PriorityLevel) || "Medium",
        estimated_minutes: task.estimated_minutes ?? 30,
        subject_name: task.subject_name || (sub ? sub.name : null),
      };
    });

    return { data: tasks, error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchDailyTasks error:", err);
    return { data: [], error: err?.message || "Failed to load daily tasks." };
  }
}

export async function createDailyTask(
  userId: string,
  task: Partial<DailyTask>
): Promise<{ data: DailyTask | null; error: string | null }> {
  try {
    const payload = {
      user_id: userId,
      title: task.title!.trim(),
      description: task.description ? task.description.trim() : null,
      subject_id: task.subject_id || null,
      subject_name: task.subject_name || null,
      task_date: task.task_date || getTodayDateString(),
      priority: task.priority || "Medium",
      estimated_minutes: task.estimated_minutes || 30,
      completed: false,
    };

    const { data, error } = await supabase.from("daily_tasks").insert([payload]).select().single();
    if (error) throw error;
    return {
      data: data
        ? {
            ...data,
            priority: (data.priority as PriorityLevel) || "Medium",
            estimated_minutes: data.estimated_minutes ?? 30,
          }
        : null,
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createDailyTask error:", err);
    return { data: null, error: err?.message || "Failed to create task." };
  }
}

export async function updateDailyTask(
  id: string,
  userId: string,
  updates: Partial<DailyTask>
): Promise<{ error: string | null }> {
  try {
    const payload: any = { ...updates, updated_at: new Date().toISOString() };
    if (updates.completed !== undefined) {
      payload.completed_at = updates.completed ? new Date().toISOString() : null;
    }

    const { error } = await supabase.from("daily_tasks").update(payload).eq("id", id);
    if (error) throw error;

    // Automatic study streak update when task is completed
    if (updates.completed) {
      await recordStudyActivity(userId);
    }
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateDailyTask error:", err);
    return { error: err?.message || "Failed to update task." };
  }
}

export async function deleteDailyTask(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("daily_tasks").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteDailyTask error:", err);
    return { error: err?.message || "Failed to delete task." };
  }
}

/* =========================================================================
   2. MONTHLY GOALS (CRUD + progress)
   ========================================================================= */

export async function fetchMonthlyGoals(
  userId: string,
  monthStr?: string
): Promise<{ data: MonthlyGoal[]; error: string | null }> {
  try {
    const targetMonth = monthStr || getCurrentMonthString();
    const { data, error } = await supabase
      .from("monthly_goals")
      .select("*")
      .eq("user_id", userId)
      .eq("month", targetMonth)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchMonthlyGoals error:", err);
    return { data: [], error: err?.message || "Failed to load monthly goals." };
  }
}

export async function createMonthlyGoal(
  userId: string,
  goal: Partial<MonthlyGoal>
): Promise<{ data: MonthlyGoal | null; error: string | null }> {
  try {
    const targetVal = goal.target_value || 100;
    const currentVal = goal.current_value || 0;
    const payload = {
      user_id: userId,
      title: goal.title!.trim(),
      description: goal.description ? goal.description.trim() : null,
      month: goal.month || getCurrentMonthString(),
      target_value: targetVal,
      current_value: currentVal,
      completed: currentVal >= targetVal,
    };

    const { data, error } = await supabase.from("monthly_goals").insert([payload]).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err: any) {
    console.error("[MBBSService] createMonthlyGoal error:", err);
    return { data: null, error: err?.message || "Failed to create goal." };
  }
}

export async function updateMonthlyGoal(
  id: string,
  updates: Partial<MonthlyGoal>
): Promise<{ error: string | null }> {
  try {
    const payload: any = { ...updates, updated_at: new Date().toISOString() };
    if (updates.target_value !== undefined || updates.current_value !== undefined) {
      const cur = updates.current_value ?? 0;
      const tar = updates.target_value ?? 100;
      if (updates.completed === undefined) {
        payload.completed = cur >= tar;
      }
    }

    const { error } = await supabase.from("monthly_goals").update(payload).eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateMonthlyGoal error:", err);
    return { error: err?.message || "Failed to update monthly goal." };
  }
}

export async function deleteMonthlyGoal(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("monthly_goals").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteMonthlyGoal error:", err);
    return { error: err?.message || "Failed to delete monthly goal." };
  }
}

/* =========================================================================
   3. SUBJECT GOALS (One goal per subject + progress %)
   ========================================================================= */

export async function fetchSubjectGoals(
  userId: string
): Promise<{ data: SubjectGoal[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("subject_goals")
      .select("*")
      .eq("user_id", userId)
      .order("subject_name", { ascending: true });

    if (error) throw error;
    const goals: SubjectGoal[] = (data || []).map((g) => ({
      ...g,
      target_topics: g.target_topics ?? 10,
      completed_topics: g.completed_topics ?? 0,
      progress_percentage: g.progress_percentage ?? 0,
      status: (g.status as GoalStatus) || "In Progress",
    }));
    return { data: goals, error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchSubjectGoals error:", err);
    return { data: [], error: err?.message || "Failed to load subject goals." };
  }
}

export async function createSubjectGoal(
  userId: string,
  goal: Partial<SubjectGoal>
): Promise<{ data: SubjectGoal | null; error: string | null }> {
  try {
    const target = goal.target_topics || 10;
    const completed = goal.completed_topics || 0;
    const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
    const status = goal.status || (pct >= 100 ? "Completed" : pct > 0 ? "In Progress" : "Not Started");

    const payload = {
      user_id: userId,
      subject_name: goal.subject_name!.trim(),
      goal_title: goal.goal_title ? goal.goal_title.trim() : `Master ${goal.subject_name!.trim()}`,
      target_topics: target,
      completed_topics: completed,
      progress_percentage: pct,
      status,
      notes: goal.notes ? goal.notes.trim() : null,
      subject_id: goal.subject_id || null,
    };

    const { data, error } = await supabase.from("subject_goals").insert([payload]).select().single();
    if (error) throw error;

    // Keep subjects table in sync
    await createSubject(userId, goal.subject_name!.trim(), target).catch(() => {});

    return {
      data: data
        ? {
            ...data,
            target_topics: data.target_topics ?? 10,
            completed_topics: data.completed_topics ?? 0,
            progress_percentage: data.progress_percentage ?? 0,
            status: (data.status as GoalStatus) || "In Progress",
          }
        : null,
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createSubjectGoal error:", err);
    return { data: null, error: err?.message || "Failed to create subject goal." };
  }
}

export async function updateSubjectGoal(
  id: string,
  updates: Partial<SubjectGoal>
): Promise<{ error: string | null }> {
  try {
    const payload: any = { ...updates, updated_at: new Date().toISOString() };
    if (updates.target_topics !== undefined || updates.completed_topics !== undefined) {
      const cur = updates.completed_topics ?? 0;
      const tar = updates.target_topics ?? 10;
      const pct = tar > 0 ? Math.min(100, Math.round((cur / tar) * 100)) : 0;
      payload.progress_percentage = pct;
      if (!updates.status) {
        payload.status = pct >= 100 ? "Completed" : pct > 0 ? "In Progress" : "Not Started";
      }
    }

    const { error } = await supabase.from("subject_goals").update(payload).eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateSubjectGoal error:", err);
    return { error: err?.message || "Failed to update subject goal." };
  }
}

export async function deleteSubjectGoal(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("subject_goals").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteSubjectGoal error:", err);
    return { error: err?.message || "Failed to delete subject goal." };
  }
}

/* =========================================================================
   4. SUBJECTS & TOPICS (Detailed syllabus structure)
   ========================================================================= */

export async function fetchSubjects(userId: string): Promise<{ data: Subject[]; error: string | null }> {
  try {
    const { data: subjectsData, error: subError } = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    if (subError) throw subError;

    // Fetch topics to compute progress
    const { data: topicsData } = await supabase
      .from("subject_topics")
      .select("subject_id, status")
      .eq("user_id", userId);

    const subjects: Subject[] = (subjectsData || []).map((sub) => {
      const subTopics = (topicsData || []).filter((t) => t.subject_id === sub.id);
      const completed = subTopics.filter((t) => t.status === "Completed").length;
      return {
        ...sub,
        target_topics: sub.target_topics ?? 0,
        total_topics: subTopics.length,
        completed_topics: completed,
      };
    });

    return { data: subjects, error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchSubjects error:", err);
    return { data: [], error: err?.message || "Failed to load subjects." };
  }
}

export async function createSubject(
  userId: string,
  name: string,
  targetTopics: number = 0
): Promise<{ data: Subject | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("subjects")
      .insert([{ user_id: userId, name: name.trim(), target_topics: targetTopics }])
      .select()
      .single();

    if (error && error.code !== "23505") throw error;
    return {
      data: data ? { ...data, target_topics: data.target_topics ?? 0 } : null,
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createSubject error:", err);
    return { data: null, error: err?.message || "Failed to create subject." };
  }
}

export async function updateSubject(
  id: string,
  name: string,
  targetTopics?: number | null
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from("subjects")
      .update({ name: name.trim(), target_topics: targetTopics ?? null, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateSubject error:", err);
    return { error: err?.message || "Failed to update subject." };
  }
}

export async function deleteSubject(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("subjects").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteSubject error:", err);
    return { error: err?.message || "Failed to delete subject." };
  }
}

export async function fetchTopics(
  userId: string,
  subjectId?: string
): Promise<{ data: SubjectTopic[]; error: string | null }> {
  try {
    let query = supabase.from("subject_topics").select("*").eq("user_id", userId);
    if (subjectId) {
      query = query.eq("subject_id", subjectId);
    }
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    const topics: SubjectTopic[] = (data || []).map((t) => ({
      ...t,
      status: (t.status as TopicStatus) || "Not Started",
      priority: (t.priority as PriorityLevel) || "Medium",
      estimated_hours: t.estimated_hours ?? 1,
    }));
    return { data: topics, error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchTopics error:", err);
    return { data: [], error: err?.message || "Failed to load topics." };
  }
}

export async function createTopic(
  userId: string,
  topic: Omit<SubjectTopic, "id" | "user_id" | "created_at" | "updated_at">
): Promise<{ data: SubjectTopic | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("subject_topics")
      .insert([{ ...topic, user_id: userId }])
      .select()
      .single();

    if (error) throw error;
    if (topic.status === "Completed") {
      await recordStudyActivity(userId);
    }
    return {
      data: data
        ? {
            ...data,
            status: (data.status as TopicStatus) || "Not Started",
            priority: (data.priority as PriorityLevel) || "Medium",
            estimated_hours: data.estimated_hours ?? 1,
          }
        : null,
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createTopic error:", err);
    return { data: null, error: err?.message || "Failed to create topic." };
  }
}

export async function updateTopic(
  id: string,
  userId: string,
  updates: Partial<SubjectTopic>
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from("subject_topics")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    if (updates.status === "Completed") {
      await recordStudyActivity(userId);
    }
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateTopic error:", err);
    return { error: err?.message || "Failed to update topic." };
  }
}

export async function deleteTopic(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("subject_topics").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteTopic error:", err);
    return { error: err?.message || "Failed to delete topic." };
  }
}

/* =========================================================================
   5. STUDY STREAKS (Automatic calculation & logging)
   ========================================================================= */

export async function recordStudyActivity(
  userId: string,
  dateStr?: string
): Promise<{ error: string | null }> {
  try {
    const studyDate = dateStr || getTodayDateString();
    const { error } = await supabase
      .from("study_streaks")
      .upsert([{ user_id: userId, study_date: studyDate }], { onConflict: "user_id,study_date" });

    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    if (err?.code === "23505") return { error: null };
    console.error("[MBBSService] recordStudyActivity error:", err);
    return { error: err?.message || "Failed to record study activity." };
  }
}

export async function fetchStreakStats(userId: string): Promise<{ stats: StreakStats; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("study_streaks")
      .select("study_date")
      .eq("user_id", userId)
      .order("study_date", { ascending: false });

    if (error) throw error;

    const dates = (data || []).map((d) => d.study_date).filter(Boolean) as string[];
    const uniqueDates = Array.from(new Set(dates)).sort().reverse();

    if (uniqueDates.length === 0) {
      return {
        stats: { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] },
        error: null,
      };
    }

    const today = getTodayDateString();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split("T")[0] || "";

    // Compute current streak
    let currentStreak = 0;
    let checkDate = new Date();
    if (!uniqueDates.includes(today) && uniqueDates.includes(yesterday)) {
      checkDate = yesterdayDate;
    }

    while (true) {
      const formatted = checkDate.toISOString().split("T")[0] || "";
      if (uniqueDates.includes(formatted)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Compute longest streak
    let longestStreak = 0;
    let tempStreak = 0;
    let prevDateMs: number | null = null;

    const sortedAsc = [...uniqueDates].sort();
    for (const dStr of sortedAsc) {
      const curMs = new Date(dStr).getTime();
      if (prevDateMs === null) {
        tempStreak = 1;
      } else {
        const diffDays = Math.round((curMs - prevDateMs) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      }
      prevDateMs = curMs;
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
    }

    return {
      stats: {
        currentStreak,
        longestStreak: Math.max(longestStreak, currentStreak),
        totalStudyDays: uniqueDates.length,
        studyDates: uniqueDates,
      },
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] fetchStreakStats error:", err);
    return {
      stats: { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] },
      error: err?.message || "Failed to load streak stats.",
    };
  }
}

/* =========================================================================
   6. EXAMS (Title, subject, date, status, notes)
   ========================================================================= */

export async function fetchExams(userId: string): Promise<{ data: Exam[]; error: string | null }> {
  try {
    const { data: examsData, error: examErr } = await supabase
      .from("exams")
      .select("*")
      .eq("user_id", userId)
      .order("exam_date", { ascending: true });

    if (examErr) throw examErr;

    const { data: subjectsData } = await supabase.from("subjects").select("id, name").eq("user_id", userId);

    const todayMs = new Date(getTodayDateString()).getTime();

    const exams: Exam[] = (examsData || []).map((ex) => {
      const sub = (subjectsData || []).find((s) => s.id === ex.subject_id);
      const exMs = new Date(ex.exam_date).getTime();
      const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

      return {
        ...ex,
        subject_name: ex.subject_name || (sub ? sub.name : null),
        exam_type: (ex.exam_type as ExamType) || "University Exam",
        status: (ex.status as ExamStatus) || "Upcoming",
        days_remaining: daysRemaining,
      };
    });

    return { data: exams, error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchExams error:", err);
    return { data: [], error: err?.message || "Failed to load exams." };
  }
}

export async function createExam(
  userId: string,
  exam: Partial<Exam>
): Promise<{ data: Exam | null; error: string | null }> {
  try {
    const payload = {
      user_id: userId,
      subject_id: exam.subject_id || null,
      subject_name: exam.subject_name || null,
      title: exam.title!.trim(),
      exam_date: exam.exam_date!,
      exam_type: exam.exam_type || "University Exam",
      status: exam.status || "Upcoming",
      notes: exam.notes ? exam.notes.trim() : null,
    };

    const { data, error } = await supabase.from("exams").insert([payload]).select().single();
    if (error) throw error;
    return {
      data: data
        ? {
            ...data,
            exam_type: (data.exam_type as ExamType) || "University Exam",
            status: (data.status as ExamStatus) || "Upcoming",
          }
        : null,
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createExam error:", err);
    return { data: null, error: err?.message || "Failed to create exam." };
  }
}

export async function updateExam(
  id: string,
  updates: Partial<Exam>
): Promise<{ error: string | null }> {
  try {
    const { days_remaining, ...dbUpdates } = updates;
    const { error } = await supabase
      .from("exams")
      .update({ ...dbUpdates, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateExam error:", err);
    return { error: err?.message || "Failed to update exam." };
  }
}

export async function deleteExam(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("exams").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteExam error:", err);
    return { error: err?.message || "Failed to delete exam." };
  }
}

/* =========================================================================
   7. STUDY NOTES (Title, content, subject)
   ========================================================================= */

export async function fetchNotes(
  userId: string,
  subjectId?: string
): Promise<{ data: Note[]; error: string | null }> {
  try {
    let query = supabase.from("notes").select("*").eq("user_id", userId);
    if (subjectId) {
      query = query.eq("subject_id", subjectId);
    }
    const { data: notesData, error: notesErr } = await query.order("updated_at", { ascending: false });
    if (notesErr) throw notesErr;

    const { data: subjectsData } = await supabase.from("subjects").select("id, name").eq("user_id", userId);

    const notes: Note[] = (notesData || []).map((n) => {
      const sub = (subjectsData || []).find((s) => s.id === n.subject_id);
      return {
        ...n,
        content: n.content || "",
        subject_name: n.subject_name || (sub ? sub.name : null),
      };
    });

    return { data: notes, error: null };
  } catch (err: any) {
    console.error("[MBBSService] fetchNotes error:", err);
    return { data: [], error: err?.message || "Failed to load study notes." };
  }
}

export async function createNote(
  userId: string,
  note: Partial<Note>
): Promise<{ data: Note | null; error: string | null }> {
  try {
    const payload = {
      user_id: userId,
      subject_id: note.subject_id || null,
      subject_name: note.subject_name || null,
      topic_id: note.topic_id || null,
      title: note.title!.trim(),
      content: note.content ? note.content.trim() : "",
    };

    const { data, error } = await supabase.from("notes").insert([payload]).select().single();
    if (error) throw error;
    return {
      data: data ? { ...data, content: data.content || "" } : null,
      error: null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createNote error:", err);
    return { data: null, error: err?.message || "Failed to create note." };
  }
}

export async function updateNote(
  id: string,
  updates: Partial<Note>
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from("notes")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] updateNote error:", err);
    return { error: err?.message || "Failed to update note." };
  }
}

export async function deleteNote(id: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    console.error("[MBBSService] deleteNote error:", err);
    return { error: err?.message || "Failed to delete note." };
  }
}
