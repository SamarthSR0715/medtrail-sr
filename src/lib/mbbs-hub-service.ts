import { supabase } from "@/integrations/supabase/client";
import type {
  Profile,
  Subject,
  SubjectGoal,
  DailyTask,
  MonthlyGoal,
  Exam,
  Note,
  StreakStats,
  PriorityLevel,
  ExamType,
  ExamStatus,
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
      console.warn("[MBBSService] Error checking profile:", fetchErr.message);
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

    if (insertErr && insertErr.code !== "23505") {
      console.warn("[MBBSService] Notice creating profile:", insertErr.message);
      return null;
    }

    return created;
  } catch (err) {
    console.warn("[MBBSService] ensureUserProfile exception:", err);
    return null;
  }
}

/* =========================================================================
   1. DAILY TASKS (CRUD + Checkbox completion with auto-streak update)
   ========================================================================= */

export async function fetchDailyTasks(userId: string, dateStr?: string): Promise<DailyTask[]> {
  try {
    const targetDate = dateStr || getTodayDateString();
    
    // Select all available columns
    let { data: tasksData, error: taskErr } = await supabase
      .from("daily_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("task_date", targetDate)
      .order("created_at", { ascending: false });

    // Fallback if task_date filter fails due to schema
    if (taskErr) {
      const fallback = await supabase
        .from("daily_tasks")
        .select("*")
        .eq("user_id", userId);
      if (!fallback.error) {
        tasksData = fallback.data;
        taskErr = null;
      }
    }

    if (taskErr) {
      console.error("[MBBSService] fetchDailyTasks error:", taskErr);
      throw new Error(taskErr.message);
    }

    // Fetch subjects for joining subject name
    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("user_id", userId);

    const tasks: DailyTask[] = (tasksData || []).map((task: any) => {
      const sub = (subjectsData || []).find((s) => s.id === task.subject_id);
      return {
        id: task.id,
        user_id: task.user_id,
        title: task.title,
        description: task.description || null,
        task_date: task.task_date || targetDate,
        priority: (task.priority as PriorityLevel) || "Medium",
        estimated_minutes: task.estimated_minutes ?? 30,
        completed: Boolean(task.completed),
        completed_at: task.completed_at || null,
        subject_id: task.subject_id || null,
        subject_name: sub ? sub.name : null,
        created_at: task.created_at || new Date().toISOString(),
        updated_at: task.updated_at || new Date().toISOString(),
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
    const fullPayload: any = {
      user_id: userId,
      title: task.title!.trim(),
      description: task.description ? task.description.trim() : null,
      subject_id: task.subject_id || null,
      task_date: task.task_date || getTodayDateString(),
      priority: task.priority || "Medium",
      estimated_minutes: task.estimated_minutes || 30,
      estimated_time: task.estimated_minutes || 30,
      completed: false,
    };

    let { data, error } = await supabase
      .from("daily_tasks")
      .insert([fullPayload])
      .select()
      .maybeSingle();

    // If a column is missing in remote DB (e.g. description/priority/estimated_minutes), gracefully retry with minimal core fields
    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      console.warn("[MBBSService] Retrying daily task insert with core columns:", error.message);
      const minimalPayload: any = {
        user_id: userId,
        title: task.title!.trim(),
        completed: false,
      };
      if (task.task_date) minimalPayload.task_date = task.task_date;
      if (task.subject_id) minimalPayload.subject_id = task.subject_id;

      const retryRes = await supabase
        .from("daily_tasks")
        .insert([minimalPayload])
        .select()
        .maybeSingle();

      if (!retryRes.error && retryRes.data) {
        data = retryRes.data;
        error = null;
      }
    }

    if (error) {
      console.error("[MBBSService] createDailyTask Supabase error:", error);
      throw new Error(error.message);
    }

    const row = data || {
      id: `task_${Date.now()}`,
      user_id: userId,
      title: task.title!,
      description: task.description ?? null,
      task_date: task.task_date || getTodayDateString(),
      priority: task.priority || "Medium",
      estimated_minutes: task.estimated_minutes ?? 30,
      completed: false,
      subject_id: task.subject_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return {
      id: row.id,
      user_id: row.user_id || userId,
      title: row.title || task.title!,
      description: row.description ?? task.description ?? null,
      task_date: row.task_date || task.task_date || getTodayDateString(),
      priority: (row.priority as PriorityLevel) || task.priority || "Medium",
      estimated_minutes: row.estimated_minutes ?? task.estimated_minutes ?? 30,
      completed: Boolean(row.completed),
      subject_id: row.subject_id || task.subject_id || null,
      subject_name: task.subject_name || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
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

    let { error } = await supabase
      .from("daily_tasks")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    // If update failed due to optional column mismatch, retry with base fields
    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      const minimalUpdate: any = {};
      if (updates.title !== undefined) minimalUpdate.title = updates.title.trim();
      if (updates.completed !== undefined) minimalUpdate.completed = updates.completed;
      
      const retry = await supabase
        .from("daily_tasks")
        .update(minimalUpdate)
        .eq("id", id)
        .eq("user_id", userId);
      
      error = retry.error;
    }

    if (error) {
      console.error("[MBBSService] updateDailyTask error:", error);
      throw new Error(error.message);
    }

    // Auto log study streak on task completion
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
    let { data, error } = await supabase
      .from("monthly_goals")
      .select("*")
      .eq("user_id", userId)
      .eq("month", targetMonth)
      .order("created_at", { ascending: false });

    // Fallback without month filter if month column is missing
    if (error) {
      const fallback = await supabase.from("monthly_goals").select("*").eq("user_id", userId);
      if (!fallback.error) {
        data = fallback.data;
        error = null;
      }
    }

    if (error) {
      console.error("[MBBSService] fetchMonthlyGoals error:", error);
      throw new Error(error.message);
    }

    return (data || []).map((g: any) => ({
      id: g.id,
      user_id: g.user_id,
      title: g.title,
      description: g.description || null,
      month: g.month || targetMonth,
      target_value: g.target_value ?? 100,
      current_value: g.current_value ?? 0,
      completed: Boolean(g.completed),
      created_at: g.created_at || new Date().toISOString(),
      updated_at: g.updated_at || new Date().toISOString(),
    }));
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

    let { data, error } = await supabase
      .from("monthly_goals")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      console.warn("[MBBSService] Retrying monthly goal insert with core fields:", error.message);
      const minimalPayload: any = {
        user_id: userId,
        title: goal.title!.trim(),
        completed: false,
      };
      const retry = await supabase.from("monthly_goals").insert([minimalPayload]).select().maybeSingle();
      if (!retry.error && retry.data) {
        data = retry.data;
        error = null;
      }
    }

    if (error) {
      console.error("[MBBSService] createMonthlyGoal error:", error);
      throw new Error(error.message);
    }

    const row = data || {
      id: `goal_${Date.now()}`,
      user_id: userId,
      title: goal.title!,
      description: goal.description ?? null,
      month: goal.month || getCurrentMonthString(),
      target_value: targetVal,
      current_value: currentVal,
      completed: currentVal >= targetVal,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return {
      id: row.id,
      user_id: row.user_id || userId,
      title: row.title || goal.title!,
      description: row.description ?? goal.description ?? null,
      month: row.month || goal.month || getCurrentMonthString(),
      target_value: row.target_value ?? targetVal,
      current_value: row.current_value ?? currentVal,
      completed: Boolean(row.completed),
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
    };
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

    let { error } = await supabase
      .from("monthly_goals")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      const minUpdate: any = {};
      if (updates.title !== undefined) minUpdate.title = updates.title.trim();
      if (updates.completed !== undefined) minUpdate.completed = updates.completed;
      const retry = await supabase.from("monthly_goals").update(minUpdate).eq("id", id).eq("user_id", userId);
      error = retry.error;
    }

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
    // 1. Try reading from subject_goals table first
    const { data: subGoalsData, error: subGoalErr } = await supabase
      .from("subject_goals")
      .select("*")
      .eq("user_id", userId)
      .order("subject_name", { ascending: true });

    // 2. Read subjects
    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    // 3. Read daily tasks to compute subject completions
    const { data: tasksData } = await supabase
      .from("daily_tasks")
      .select("subject_id, completed")
      .eq("user_id", userId);

    const subjects: Subject[] = (subjectsData || []).map((sub: any) => {
      const subTasks = (tasksData || []).filter((t: any) => t.subject_id === sub.id);
      const completed = subTasks.filter((t: any) => t.completed).length;
      return {
        id: sub.id,
        user_id: sub.user_id,
        name: sub.name,
        target_topics: sub.target_topics ?? 10,
        total_topics: subTasks.length,
        completed_topics: completed,
        created_at: sub.created_at || new Date().toISOString(),
        updated_at: sub.updated_at || new Date().toISOString(),
      };
    });

    let subjectGoals: SubjectGoal[] = [];

    if (!subGoalErr && subGoalsData && subGoalsData.length > 0) {
      subjectGoals = subGoalsData.map((g: any) => {
        const target = Math.max(1, g.target_topics || 10);
        const completed = g.completed_topics || 0;
        const pct = g.progress_percentage ?? Math.min(100, Math.round((completed / target) * 100));
        return {
          id: g.id,
          user_id: g.user_id,
          subject_id: g.subject_id || null,
          subject_name: g.subject_name,
          goal_title: g.goal_title || `Master ${g.subject_name}`,
          target_topics: target,
          completed_topics: completed,
          progress_percentage: pct,
          status: (g.status as GoalStatus) || (pct >= 100 ? "Completed" : completed > 0 ? "In Progress" : "Not Started"),
          notes: g.notes || null,
          created_at: g.created_at || new Date().toISOString(),
          updated_at: g.updated_at || new Date().toISOString(),
        };
      });
    } else {
      // Fallback: derive subject goals from subjects table
      subjectGoals = subjects.map((sub) => {
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
    }

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
    const name = goal.subject_name.trim();

    // Also sync with subjects table
    const { data: subData } = await supabase
      .from("subjects")
      .insert([{ user_id: userId, name, target_topics: target }])
      .select()
      .maybeSingle();

    // Try inserting into subject_goals
    const payload = {
      user_id: userId,
      subject_name: name,
      goal_title: goal.goal_title || `Master ${name}`,
      target_topics: target,
      completed_topics: 0,
      progress_percentage: 0,
      status: "Not Started",
      notes: goal.notes || null,
      subject_id: subData?.id || null,
    };

    let { data, error } = await supabase
      .from("subject_goals")
      .insert([payload])
      .select()
      .maybeSingle();

    // If subject_goals table does not exist, use subjects record
    if (error || !data) {
      console.warn("[MBBSService] Using subjects table as fallback for subject goal:", error?.message);
      return {
        id: subData?.id || `sub_${Date.now()}`,
        user_id: userId,
        subject_id: subData?.id || null,
        subject_name: name,
        goal_title: goal.goal_title || `Master ${name}`,
        target_topics: target,
        completed_topics: 0,
        progress_percentage: 0,
        status: "Not Started",
        notes: goal.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    return {
      id: data.id,
      user_id: data.user_id,
      subject_id: data.subject_id || subData?.id || null,
      subject_name: data.subject_name,
      goal_title: data.goal_title || `Master ${data.subject_name}`,
      target_topics: data.target_topics ?? target,
      completed_topics: data.completed_topics ?? 0,
      progress_percentage: data.progress_percentage ?? 0,
      status: "Not Started",
      notes: data.notes || null,
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
    if (updates.subject_name) payload.subject_name = updates.subject_name.trim();
    if (updates.target_topics !== undefined && updates.target_topics !== null) payload.target_topics = Number(updates.target_topics) || 10;
    if (updates.completed_topics !== undefined && updates.completed_topics !== null) payload.completed_topics = Number(updates.completed_topics) || 0;

    // Try updating subject_goals
    await supabase
      .from("subject_goals")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    // Also update subjects table
    const subPayload: any = { updated_at: new Date().toISOString() };
    if (updates.subject_name) subPayload.name = updates.subject_name.trim();
    if (updates.target_topics !== undefined && updates.target_topics !== null) subPayload.target_topics = Number(updates.target_topics) || 10;

    await supabase.from("subjects").update(subPayload).eq("id", id).eq("user_id", userId);
  } catch (err: any) {
    console.error("[MBBSService] updateSubjectGoal exception:", err);
    throw err;
  }
}

export async function deleteSubjectGoal(id: string, userId: string): Promise<void> {
  try {
    await supabase.from("subject_goals").delete().eq("id", id).eq("user_id", userId);
    await supabase.from("subjects").delete().eq("id", id).eq("user_id", userId);
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
      console.warn("[MBBSService] recordStudyActivity notice:", error.message);
    }
  } catch (err: any) {
    console.warn("[MBBSService] recordStudyActivity exception:", err);
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
      console.warn("[MBBSService] fetchStreakStats notice:", error.message);
      return { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] };
    }

    const dates = (data || []).map((d: any) => d.study_date).filter(Boolean) as string[];
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
    console.warn("[MBBSService] fetchStreakStats exception:", err);
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

    const exams: Exam[] = (examsData || []).map((ex: any) => {
      const sub = (subjectsData || []).find((s) => s.id === ex.subject_id);
      const exMs = new Date(ex.exam_date).getTime();
      const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

      return {
        id: ex.id,
        user_id: ex.user_id,
        title: ex.title,
        exam_date: ex.exam_date,
        subject_id: ex.subject_id || null,
        subject_name: sub ? sub.name : null,
        exam_type: (ex.exam_type as ExamType) || "University Exam",
        status: (ex.status as ExamStatus) || (daysRemaining < 0 ? "Completed" : "Upcoming"),
        notes: ex.notes || null,
        days_remaining: daysRemaining,
        created_at: ex.created_at || new Date().toISOString(),
        updated_at: ex.updated_at || new Date().toISOString(),
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
    const payload = {
      user_id: userId,
      subject_id: exam.subject_id || null,
      title: exam.title!.trim(),
      exam_date: exam.exam_date || getTodayDateString(),
      exam_type: exam.exam_type || "University Exam",
      notes: exam.notes ? exam.notes.trim() : null,
    };

    let { data, error } = await supabase
      .from("exams")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      console.warn("[MBBSService] Retrying exam insert with core fields:", error.message);
      const minPayload: any = {
        user_id: userId,
        title: exam.title!.trim(),
        exam_date: exam.exam_date || getTodayDateString(),
      };
      const retry = await supabase.from("exams").insert([minPayload]).select().maybeSingle();
      if (!retry.error && retry.data) {
        data = retry.data;
        error = null;
      }
    }

    if (error) {
      console.error("[MBBSService] createExam error:", error);
      throw new Error(error.message);
    }

    const row = data || {
      id: `exam_${Date.now()}`,
      user_id: userId,
      title: exam.title!,
      exam_date: exam.exam_date || getTodayDateString(),
      subject_id: exam.subject_id || null,
      exam_type: exam.exam_type || "University Exam",
      status: "Upcoming",
      notes: exam.notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const todayMs = new Date(getTodayDateString()).getTime();
    const exMs = new Date(row.exam_date || getTodayDateString()).getTime();
    const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

    return {
      id: row.id,
      user_id: row.user_id || userId,
      title: row.title || exam.title!,
      exam_date: row.exam_date || exam.exam_date || getTodayDateString(),
      subject_id: row.subject_id || exam.subject_id || null,
      subject_name: exam.subject_name || null,
      exam_type: (row.exam_type as ExamType) || exam.exam_type || "University Exam",
      status: (row.status as ExamStatus) || (daysRemaining < 0 ? "Completed" : "Upcoming"),
      notes: row.notes ?? exam.notes ?? null,
      days_remaining: daysRemaining,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
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

    let { error } = await supabase
      .from("exams")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      const minUpdate: any = {};
      if (updates.title !== undefined) minUpdate.title = updates.title.trim();
      if (updates.exam_date !== undefined) minUpdate.exam_date = updates.exam_date;
      const retry = await supabase.from("exams").update(minUpdate).eq("id", id).eq("user_id", userId);
      error = retry.error;
    }

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

    const notes: Note[] = (notesData || []).map((n: any) => {
      const sub = (subjectsData || []).find((s) => s.id === n.subject_id);
      return {
        id: n.id,
        user_id: n.user_id,
        title: n.title,
        content: n.content || "",
        subject_id: n.subject_id || null,
        topic_id: n.topic_id || null,
        subject_name: sub ? sub.name : null,
        created_at: n.created_at || new Date().toISOString(),
        updated_at: n.updated_at || new Date().toISOString(),
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

    let { data, error } = await supabase
      .from("notes")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      console.warn("[MBBSService] Retrying note insert with core fields:", error.message);
      const minPayload: any = {
        user_id: userId,
        title: note.title!.trim(),
      };
      const retry = await supabase.from("notes").insert([minPayload]).select().maybeSingle();
      if (!retry.error && retry.data) {
        data = retry.data;
        error = null;
      }
    }

    if (error) {
      console.error("[MBBSService] createNote error:", error);
      throw new Error(error.message);
    }

    const row = data || {
      id: `note_${Date.now()}`,
      user_id: userId,
      title: note.title!,
      content: note.content || "",
      subject_id: note.subject_id || null,
      topic_id: note.topic_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return {
      id: row.id,
      user_id: row.user_id || userId,
      title: row.title || note.title!,
      content: row.content ?? note.content ?? "",
      subject_id: row.subject_id || note.subject_id || null,
      topic_id: row.topic_id || note.topic_id || null,
      subject_name: note.subject_name || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString(),
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

    let { error } = await supabase
      .from("notes")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);

    if (error && (error.message.includes("column") || error.code === "PGRST204")) {
      const minUpdate: any = {};
      if (updates.title !== undefined) minUpdate.title = updates.title.trim();
      const retry = await supabase.from("notes").update(minUpdate).eq("id", id).eq("user_id", userId);
      error = retry.error;
    }

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
