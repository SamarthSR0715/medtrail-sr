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

export async function ensureUserProfile(user: { id: string; email?: string | null; user_metadata?: any }): Promise<Profile | null> {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchErr) {
      console.error("[MBBSService] Error checking profile:", fetchErr);
    }

    if (existing) {
      return existing;
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
      .maybeSingle();

    if (insertErr) {
      if (insertErr.code !== "23505") {
        console.error("[MBBSService] Error creating profile:", insertErr);
      }
      return null;
    }

    return created;
  } catch (err) {
    console.error("[MBBSService] ensureUserProfile exception:", err);
    return null;
  }
}

/* =========================================================================
   1. DAILY TASKS (CRUD + Checkbox completion with auto-streak update)
   ========================================================================= */

export async function fetchDailyTasks(userId: string, dateStr?: string): Promise<DailyTask[]> {
  try {
    const targetDate = dateStr || getTodayDateString();
    const { data: tasksData, error: taskErr } = await supabase
      .from("daily_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("task_date", targetDate)
      .order("created_at", { ascending: false });

    if (taskErr) {
      console.error("[MBBSService] fetchDailyTasks error:", taskErr);
      throw new Error(taskErr.message);
    }

    // Fetch subjects for joining name
    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("user_id", userId);

    const tasks: DailyTask[] = (tasksData || []).map((task) => {
      const sub = (subjectsData || []).find((s) => s.id === task.subject_id);
      return {
        ...task,
        priority: (task.priority as PriorityLevel) || "Medium",
        estimated_minutes: task.estimated_minutes ?? 30,
        subject_name: sub ? sub.name : null,
      };
    });

    return tasks;
  } catch (err: any) {
    console.error("[MBBSService] fetchDailyTasks exception:", err);
    throw err;
  }
}

export async function createDailyTask(userId: string, task: Partial<DailyTask>): Promise<DailyTask> {
  try {
    // Only send valid columns to Supabase daily_tasks table
    const payload = {
      user_id: userId,
      title: task.title!.trim(),
      description: task.description ? task.description.trim() : null,
      subject_id: task.subject_id || null,
      task_date: task.task_date || getTodayDateString(),
      priority: task.priority || "Medium",
      estimated_minutes: task.estimated_minutes || 30,
      completed: false,
    };

    const { data, error } = await supabase
      .from("daily_tasks")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("[MBBSService] createDailyTask Supabase error:", error);
      throw new Error(error.message);
    }

    return {
      ...data,
      priority: (data.priority as PriorityLevel) || "Medium",
      estimated_minutes: data.estimated_minutes ?? 30,
      subject_name: task.subject_name || null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createDailyTask exception:", err);
    throw err;
  }
}

export async function updateDailyTask(
  id: string,
  userId: string,
  updates: Partial<DailyTask>
): Promise<void> {
  try {
    const payload: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.description !== undefined) payload.description = updates.description ? updates.description.trim() : null;
    if (updates.subject_id !== undefined) payload.subject_id = updates.subject_id || null;
    if (updates.task_date !== undefined) payload.task_date = updates.task_date;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.estimated_minutes !== undefined) payload.estimated_minutes = updates.estimated_minutes;
    if (updates.completed !== undefined) {
      payload.completed = updates.completed;
      payload.completed_at = updates.completed ? new Date().toISOString() : null;
    }

    const { error } = await supabase
      .from("daily_tasks")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] updateDailyTask error:", error);
      throw new Error(error.message);
    }

    // Automatic study streak update when task is completed
    if (updates.completed) {
      await recordStudyActivity(userId).catch((e) => console.error("Streak record error:", e));
    }
  } catch (err: any) {
    console.error("[MBBSService] updateDailyTask exception:", err);
    throw err;
  }
}

export async function deleteDailyTask(id: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("daily_tasks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] deleteDailyTask error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] deleteDailyTask exception:", err);
    throw err;
  }
}

/* =========================================================================
   2. MONTHLY GOALS (CRUD + progress)
   ========================================================================= */

export async function fetchMonthlyGoals(userId: string, monthStr?: string): Promise<MonthlyGoal[]> {
  try {
    const targetMonth = monthStr || getCurrentMonthString();
    const { data, error } = await supabase
      .from("monthly_goals")
      .select("*")
      .eq("user_id", userId)
      .eq("month", targetMonth)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[MBBSService] fetchMonthlyGoals error:", error);
      throw new Error(error.message);
    }
    return data || [];
  } catch (err: any) {
    console.error("[MBBSService] fetchMonthlyGoals exception:", err);
    throw err;
  }
}

export async function createMonthlyGoal(userId: string, goal: Partial<MonthlyGoal>): Promise<MonthlyGoal> {
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

    const { data, error } = await supabase
      .from("monthly_goals")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("[MBBSService] createMonthlyGoal error:", error);
      throw new Error(error.message);
    }
    return data;
  } catch (err: any) {
    console.error("[MBBSService] createMonthlyGoal exception:", err);
    throw err;
  }
}

export async function updateMonthlyGoal(
  id: string,
  userId: string,
  updates: Partial<MonthlyGoal>
): Promise<void> {
  try {
    const payload: any = { ...updates, updated_at: new Date().toISOString() };
    if (updates.target_value !== undefined || updates.current_value !== undefined) {
      const cur = updates.current_value ?? 0;
      const tar = updates.target_value ?? 100;
      if (updates.completed === undefined) {
        payload.completed = cur >= tar;
      }
    }

    const { error } = await supabase
      .from("monthly_goals")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] updateMonthlyGoal error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] updateMonthlyGoal exception:", err);
    throw err;
  }
}

export async function deleteMonthlyGoal(id: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("monthly_goals")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] deleteMonthlyGoal error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] deleteMonthlyGoal exception:", err);
    throw err;
  }
}

/* =========================================================================
   3. SUBJECT GOALS & SUBJECTS (One goal per subject + progress %)
   ========================================================================= */

export async function fetchSubjectsAndGoals(userId: string): Promise<{ subjects: Subject[]; subjectGoals: SubjectGoal[] }> {
  try {
    const { data: subjectsData, error } = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) {
      console.error("[MBBSService] fetchSubjects error:", error);
      throw new Error(error.message);
    }

    // Fetch tasks to calculate completed topics for each subject
    const { data: tasksData } = await supabase
      .from("daily_tasks")
      .select("subject_id, completed")
      .eq("user_id", userId);

    const subjects: Subject[] = (subjectsData || []).map((sub) => {
      const subTasks = (tasksData || []).filter((t) => t.subject_id === sub.id);
      const completed = subTasks.filter((t) => t.completed).length;
      return {
        ...sub,
        target_topics: sub.target_topics ?? 10,
        total_topics: subTasks.length,
        completed_topics: completed,
      };
    });

    const subjectGoals: SubjectGoal[] = subjects.map((sub) => {
      const target = Math.max(1, sub.target_topics || 10);
      const completed = sub.completed_topics || 0;
      const pct = Math.min(100, Math.round((completed / target) * 100));
      const status: GoalStatus = pct >= 100 ? "Completed" : completed > 0 ? "In Progress" : "Not Started";

      return {
        id: sub.id,
        user_id: sub.user_id,
        subject_id: sub.id,
        subject_name: sub.name,
        goal_title: `Master ${sub.name}`,
        target_topics: target,
        completed_topics: completed,
        progress_percentage: pct,
        status,
        created_at: sub.created_at || new Date().toISOString(),
        updated_at: sub.updated_at || new Date().toISOString(),
      };
    });

    return { subjects, subjectGoals };
  } catch (err: any) {
    console.error("[MBBSService] fetchSubjectsAndGoals exception:", err);
    throw err;
  }
}

export async function createSubjectGoal(
  userId: string,
  goal: { subject_name: string; target_topics?: number | null; goal_title?: string | null; notes?: string | null }
): Promise<SubjectGoal> {
  try {
    const target = goal.target_topics || 10;
    const { data, error } = await supabase
      .from("subjects")
      .insert([
        {
          user_id: userId,
          name: goal.subject_name.trim(),
          target_topics: target,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[MBBSService] createSubjectGoal error:", error);
      throw new Error(error.message);
    }

    return {
      id: data.id,
      user_id: data.user_id,
      subject_id: data.id,
      subject_name: data.name,
      goal_title: goal.goal_title || `Master ${data.name}`,
      target_topics: data.target_topics ?? target,
      completed_topics: 0,
      progress_percentage: 0,
      status: "Not Started",
      notes: goal.notes || null,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[MBBSService] createSubjectGoal exception:", err);
    throw err;
  }
}

export async function updateSubjectGoal(
  id: string,
  userId: string,
  updates: { subject_name?: string | null; target_topics?: number | null; completed_topics?: number | null }
): Promise<void> {
  try {
    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.subject_name) payload.name = updates.subject_name.trim();
    if (updates.target_topics !== undefined) payload.target_topics = Number(updates.target_topics) || 10;

    const { error } = await supabase
      .from("subjects")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] updateSubjectGoal error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] updateSubjectGoal exception:", err);
    throw err;
  }
}

export async function deleteSubjectGoal(id: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("subjects")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] deleteSubjectGoal error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] deleteSubjectGoal exception:", err);
    throw err;
  }
}

/* =========================================================================
   4. STUDY STREAKS (Automatic calculation & logging)
   ========================================================================= */

export async function recordStudyActivity(userId: string, dateStr?: string): Promise<void> {
  try {
    const studyDate = dateStr || getTodayDateString();
    const { error } = await supabase
      .from("study_streaks")
      .upsert([{ user_id: userId, study_date: studyDate }], { onConflict: "user_id,study_date" });

    if (error && error.code !== "23505") {
      console.error("[MBBSService] recordStudyActivity error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] recordStudyActivity exception:", err);
  }
}

export async function fetchStreakStats(userId: string): Promise<StreakStats> {
  try {
    const { data, error } = await supabase
      .from("study_streaks")
      .select("study_date")
      .eq("user_id", userId)
      .order("study_date", { ascending: false });

    if (error) {
      console.error("[MBBSService] fetchStreakStats error:", error);
      return { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] };
    }

    const dates = (data || []).map((d) => d.study_date).filter(Boolean) as string[];
    const uniqueDates = Array.from(new Set(dates)).sort().reverse();

    if (uniqueDates.length === 0) {
      return { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] };
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
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      totalStudyDays: uniqueDates.length,
      studyDates: uniqueDates,
    };
  } catch (err: any) {
    console.error("[MBBSService] fetchStreakStats exception:", err);
    return { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] };
  }
}

/* =========================================================================
   5. EXAMS (Title, subject, date, status, notes)
   ========================================================================= */

export async function fetchExams(userId: string): Promise<Exam[]> {
  try {
    const { data: examsData, error: examErr } = await supabase
      .from("exams")
      .select("*")
      .eq("user_id", userId)
      .order("exam_date", { ascending: true });

    if (examErr) {
      console.error("[MBBSService] fetchExams error:", examErr);
      throw new Error(examErr.message);
    }

    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("user_id", userId);

    const todayMs = new Date(getTodayDateString()).getTime();

    const exams: Exam[] = (examsData || []).map((ex) => {
      const sub = (subjectsData || []).find((s) => s.id === ex.subject_id);
      const exMs = new Date(ex.exam_date).getTime();
      const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

      return {
        ...ex,
        subject_name: sub ? sub.name : null,
        exam_type: (ex.exam_type as ExamType) || "University Exam",
        status: daysRemaining < 0 ? ("Completed" as ExamStatus) : ("Upcoming" as ExamStatus),
        days_remaining: daysRemaining,
      };
    });

    return exams;
  } catch (err: any) {
    console.error("[MBBSService] fetchExams exception:", err);
    throw err;
  }
}

export async function createExam(userId: string, exam: Partial<Exam>): Promise<Exam> {
  try {
    // Only send columns that exist in DB: user_id, subject_id, title, exam_date, exam_type, notes
    const payload = {
      user_id: userId,
      subject_id: exam.subject_id || null,
      title: exam.title!.trim(),
      exam_date: exam.exam_date!,
      exam_type: exam.exam_type || "University Exam",
      notes: exam.notes ? exam.notes.trim() : null,
    };

    const { data, error } = await supabase
      .from("exams")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("[MBBSService] createExam error:", error);
      throw new Error(error.message);
    }

    const todayMs = new Date(getTodayDateString()).getTime();
    const exMs = new Date(data.exam_date).getTime();
    const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

    return {
      ...data,
      subject_name: exam.subject_name || null,
      exam_type: (data.exam_type as ExamType) || "University Exam",
      status: daysRemaining < 0 ? ("Completed" as ExamStatus) : ("Upcoming" as ExamStatus),
      days_remaining: daysRemaining,
    };
  } catch (err: any) {
    console.error("[MBBSService] createExam exception:", err);
    throw err;
  }
}

export async function updateExam(
  id: string,
  userId: string,
  updates: Partial<Exam>
): Promise<void> {
  try {
    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.exam_date !== undefined) payload.exam_date = updates.exam_date;
    if (updates.exam_type !== undefined) payload.exam_type = updates.exam_type;
    if (updates.subject_id !== undefined) payload.subject_id = updates.subject_id || null;
    if (updates.notes !== undefined) payload.notes = updates.notes ? updates.notes.trim() : null;

    const { error } = await supabase
      .from("exams")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] updateExam error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] updateExam exception:", err);
    throw err;
  }
}

export async function deleteExam(id: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("exams")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] deleteExam error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] deleteExam exception:", err);
    throw err;
  }
}

/* =========================================================================
   6. STUDY NOTES (Title, content, subject)
   ========================================================================= */

export async function fetchNotes(userId: string, subjectId?: string): Promise<Note[]> {
  try {
    let query = supabase.from("notes").select("*").eq("user_id", userId);
    if (subjectId) {
      query = query.eq("subject_id", subjectId);
    }
    const { data: notesData, error: notesErr } = await query.order("updated_at", { ascending: false });
    if (notesErr) {
      console.error("[MBBSService] fetchNotes error:", notesErr);
      throw new Error(notesErr.message);
    }

    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("user_id", userId);

    const notes: Note[] = (notesData || []).map((n) => {
      const sub = (subjectsData || []).find((s) => s.id === n.subject_id);
      return {
        ...n,
        content: n.content || "",
        subject_name: sub ? sub.name : null,
      };
    });

    return notes;
  } catch (err: any) {
    console.error("[MBBSService] fetchNotes exception:", err);
    throw err;
  }
}

export async function createNote(userId: string, note: Partial<Note>): Promise<Note> {
  try {
    const payload = {
      user_id: userId,
      subject_id: note.subject_id || null,
      topic_id: note.topic_id || null,
      title: note.title!.trim(),
      content: note.content ? note.content.trim() : "",
    };

    const { data, error } = await supabase
      .from("notes")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("[MBBSService] createNote error:", error);
      throw new Error(error.message);
    }

    return {
      ...data,
      content: data.content || "",
      subject_name: note.subject_name || null,
    };
  } catch (err: any) {
    console.error("[MBBSService] createNote exception:", err);
    throw err;
  }
}

export async function updateNote(
  id: string,
  userId: string,
  updates: Partial<Note>
): Promise<void> {
  try {
    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.content !== undefined) payload.content = updates.content ? updates.content.trim() : "";
    if (updates.subject_id !== undefined) payload.subject_id = updates.subject_id || null;

    const { error } = await supabase
      .from("notes")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] updateNote error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] updateNote exception:", err);
    throw err;
  }
}

export async function deleteNote(id: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[MBBSService] deleteNote error:", error);
      throw new Error(error.message);
    }
  } catch (err: any) {
    console.error("[MBBSService] deleteNote exception:", err);
    throw err;
  }
}
