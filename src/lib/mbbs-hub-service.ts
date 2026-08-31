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

// Priority mapping helpers for PostgreSQL daily_tasks_priority_check constraint ('low', 'medium', 'high')
function toDbPriority(priority?: string | null): "low" | "medium" | "high" {
  if (!priority) return "medium";
  const lower = priority.toLowerCase();
  if (lower === "high") return "high";
  if (lower === "low") return "low";
  return "medium";
}

function toUiPriority(priority?: string | null): PriorityLevel {
  if (!priority) return "Medium";
  const lower = priority.toLowerCase();
  if (lower === "high") return "High";
  if (lower === "low") return "Low";
  return "Medium";
}

// Monthly Goal metadata helpers (storing target/current progress in description)
function encodeMonthlyGoalDesc(target: number, current: number, userDesc?: string | null): string {
  const meta = { target_value: target, current_value: current, notes: userDesc || "" };
  return JSON.stringify(meta);
}

function parseMonthlyGoalDesc(desc?: string | null, completed = false): { target_value: number; current_value: number; description: string | null } {
  if (!desc) {
    return {
      target_value: 100,
      current_value: completed ? 100 : 0,
      description: null,
    };
  }
  try {
    if (desc.trim().startsWith("{") && desc.trim().endsWith("}")) {
      const parsed = JSON.parse(desc.trim());
      const target = Number(parsed.target_value) || 100;
      const current = parsed.current_value !== undefined ? Number(parsed.current_value) : completed ? target : 0;
      return {
        target_value: target,
        current_value: current,
        description: parsed.notes || null,
      };
    }
  } catch (_) {}
  return {
    target_value: 100,
    current_value: completed ? 100 : 0,
    description: desc,
  };
}

// Exam metadata helpers (storing exam_type, status, subject_id, subject_name, notes in description)
function encodeExamDesc(meta: {
  exam_type?: string;
  status?: string;
  subject_id?: string | null;
  subject_name?: string | null;
  notes?: string | null;
}): string {
  const payload = {
    exam_type: meta.exam_type || "University Exam",
    status: meta.status || "Upcoming",
    subject_id: meta.subject_id || null,
    subject_name: meta.subject_name || null,
    notes: meta.notes || "",
  };
  return JSON.stringify(payload);
}

function parseExamDesc(desc?: string | null): {
  exam_type: ExamType;
  status: ExamStatus;
  subject_id: string | null;
  subject_name: string | null;
  notes: string | null;
} {
  const fallback = {
    exam_type: "University Exam" as ExamType,
    status: "Upcoming" as ExamStatus,
    subject_id: null,
    subject_name: null,
    notes: desc || null,
  };
  if (!desc) return fallback;
  try {
    if (desc.trim().startsWith("{") && desc.trim().endsWith("}")) {
      const parsed = JSON.parse(desc.trim());
      return {
        exam_type: (parsed.exam_type as ExamType) || fallback.exam_type,
        status: (parsed.status as ExamStatus) || fallback.status,
        subject_id: parsed.subject_id || null,
        subject_name: parsed.subject_name || null,
        notes: parsed.notes || null,
      };
    }
  } catch (_) {}
  return fallback;
}

// Subject Goal topic metadata helpers
const GOAL_META_PREFIX = "__SG_META__:";
function encodeGoalMetaTopic(meta: {
  goal_title?: string | null;
  target_topics?: number;
  completed_topics?: number;
  status?: string;
  notes?: string | null;
}): string {
  return `${GOAL_META_PREFIX}${JSON.stringify(meta)}`;
}

function parseGoalMetaTopic(title: string): {
  isGoalMeta: boolean;
  goal_title?: string;
  target_topics?: number;
  completed_topics?: number;
  status?: GoalStatus;
  notes?: string | null;
} {
  if (!title.startsWith(GOAL_META_PREFIX)) {
    return { isGoalMeta: false };
  }
  try {
    const raw = title.slice(GOAL_META_PREFIX.length);
    const parsed = JSON.parse(raw);
    return {
      isGoalMeta: true,
      goal_title: parsed.goal_title,
      target_topics: parsed.target_topics,
      completed_topics: parsed.completed_topics,
      status: parsed.status as GoalStatus,
      notes: parsed.notes || null,
    };
  } catch (_) {
    return { isGoalMeta: false };
  }
}

/* =========================================================================
   0. USER PROFILE
   ========================================================================= */

export async function ensureUserProfile(user: { id: string; email?: string | null; user_metadata?: any }): Promise<Profile | null> {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
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
      .upsert([
        {
          id: user.id,
          full_name: fullName,
          email: user.email || null,
        },
      ])
      .select()
      .maybeSingle();

    if (insertErr) {
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
   1. DAILY TASKS (CRUD + Checkbox completion + auto streak)
   ========================================================================= */

export async function fetchDailyTasks(userId: string, dateStr?: string): Promise<DailyTask[]> {
  try {
    const targetDate = dateStr || getTodayDateString();

    const { data: tasksData, error: taskErr } = await supabase
      .from("daily_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (taskErr) {
      console.error("[MBBSService] fetchDailyTasks error:", taskErr);
      throw new Error(taskErr.message);
    }

    // Fetch subjects for joining subject name
    const { data: subjectsData } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("user_id", userId);

    const tasks: DailyTask[] = (tasksData || []).map((task) => {
      const sub = (subjectsData || []).find((s) => s.id === task.subject_id);
      return {
        id: task.id,
        user_id: task.user_id,
        title: task.title,
        description: task.description || task.notes || null,
        task_date: task.task_date || targetDate,
        priority: toUiPriority(task.priority),
        estimated_minutes: task.estimated_minutes ?? task.estimated_time ?? 30,
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
    const minutes = task.estimated_minutes || 30;
    const dbPriority = toDbPriority(task.priority);
    const taskDate = task.task_date || getTodayDateString();

    const payload = {
      user_id: userId,
      title: task.title!.trim(),
      description: task.description ? task.description.trim() : null,
      notes: task.description ? task.description.trim() : null,
      subject_id: task.subject_id && task.subject_id.trim() ? task.subject_id.trim() : null,
      task_date: taskDate,
      priority: dbPriority,
      estimated_minutes: minutes,
      estimated_time: minutes,
      completed: false,
    };

    const { data, error } = await supabase
      .from("daily_tasks")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error) {
      console.error("[MBBSService] createDailyTask Supabase error:", error);
      throw new Error(error.message);
    }

    const row = data!;
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      description: row.description || row.notes || null,
      task_date: row.task_date || taskDate,
      priority: toUiPriority(row.priority),
      estimated_minutes: row.estimated_minutes ?? minutes,
      completed: Boolean(row.completed),
      subject_id: row.subject_id || null,
      subject_name: task.subject_name || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
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
    if (updates.description !== undefined) {
      payload.description = updates.description ? updates.description.trim() : null;
      payload.notes = updates.description ? updates.description.trim() : null;
    }
    if (updates.subject_id !== undefined) {
      payload.subject_id = updates.subject_id && updates.subject_id.trim() ? updates.subject_id.trim() : null;
    }
    if (updates.task_date !== undefined) payload.task_date = updates.task_date;
    if (updates.priority !== undefined) payload.priority = toDbPriority(updates.priority);
    if (updates.estimated_minutes !== undefined) {
      payload.estimated_minutes = updates.estimated_minutes;
      payload.estimated_time = updates.estimated_minutes;
    }
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
    const { data, error } = await supabase
      .from("monthly_goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[MBBSService] fetchMonthlyGoals error:", error);
      throw new Error(error.message);
    }

    return (data || []).map((g) => {
      const parsed = parseMonthlyGoalDesc(g.description, g.completed);
      const goalMonth = g.goal_month ? g.goal_month.slice(0, 7) : targetMonth;
      return {
        id: g.id,
        user_id: g.user_id,
        title: g.title,
        description: parsed.description,
        month: goalMonth,
        target_value: parsed.target_value,
        current_value: parsed.current_value,
        completed: Boolean(g.completed),
        created_at: g.created_at || new Date().toISOString(),
        updated_at: g.updated_at || new Date().toISOString(),
      };
    });
  } catch (err: any) {
    console.error("[MBBSService] fetchMonthlyGoals exception:", err);
    throw err;
  }
}

export async function createMonthlyGoal(userId: string, goal: Partial<MonthlyGoal>): Promise<MonthlyGoal> {
  try {
    const targetVal = goal.target_value || 100;
    const currentVal = goal.current_value || 0;
    const rawMonth = goal.month || getCurrentMonthString();
    const goalMonthDate = `${rawMonth.slice(0, 7)}-01`;
    const isDone = Boolean(goal.completed || currentVal >= targetVal);
    const encodedDesc = encodeMonthlyGoalDesc(targetVal, currentVal, goal.description);

    const payload = {
      user_id: userId,
      title: goal.title!.trim(),
      goal_month: goalMonthDate,
      description: encodedDesc,
      completed: isDone,
      completed_at: isDone ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
      .from("monthly_goals")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error) {
      console.error("[MBBSService] createMonthlyGoal error:", error);
      throw new Error(error.message);
    }

    const row = data!;
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      description: goal.description ? goal.description.trim() : null,
      month: rawMonth.slice(0, 7),
      target_value: targetVal,
      current_value: currentVal,
      completed: row.completed,
      created_at: row.created_at,
      updated_at: row.updated_at,
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
    // Fetch existing goal to preserve units if not provided
    const { data: existing } = await supabase
      .from("monthly_goals")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    const existingParsed = parseMonthlyGoalDesc(existing?.description, existing?.completed);

    const targetVal = updates.target_value !== undefined ? updates.target_value : existingParsed.target_value;
    const currentVal = updates.current_value !== undefined ? updates.current_value : existingParsed.current_value;
    const descText = updates.description !== undefined ? updates.description : existingParsed.description;

    const isCompleted =
      updates.completed !== undefined
        ? updates.completed
        : currentVal >= targetVal;

    const payload: any = {
      updated_at: new Date().toISOString(),
      completed: isCompleted,
      completed_at: isCompleted ? new Date().toISOString() : null,
      description: encodeMonthlyGoalDesc(targetVal, currentVal, descText),
    };

    if (updates.title !== undefined) payload.title = updates.title.trim();
    if (updates.month !== undefined) payload.goal_month = `${updates.month.slice(0, 7)}-01`;

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
   3. SUBJECT GOALS & SUBJECTS (Using subjects and topics tables)
   ========================================================================= */

export async function fetchSubjectsAndGoals(userId: string): Promise<{ subjects: Subject[]; subjectGoals: SubjectGoal[] }> {
  try {
    // 1. Fetch subjects
    const { data: subjectsData, error: subErr } = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (subErr) {
      console.error("[MBBSService] fetch subjects error:", subErr);
      throw new Error(subErr.message);
    }

    // 2. Fetch topics
    const { data: topicsData } = await supabase
      .from("topics")
      .select("*")
      .eq("user_id", userId);

    // 3. Fetch daily tasks to factor in task completions
    const { data: tasksData } = await supabase
      .from("daily_tasks")
      .select("subject_id, completed")
      .eq("user_id", userId);

    const subjects: Subject[] = (subjectsData || []).map((sub) => {
      const subTopics = (topicsData || []).filter((t) => t.subject_id === sub.id && !t.title.startsWith(GOAL_META_PREFIX));
      const subTasks = (tasksData || []).filter((t) => t.subject_id === sub.id);
      const completedTopics = subTopics.filter((t) => t.completed).length + subTasks.filter((t) => t.completed).length;
      const totalTopics = Math.max(subTopics.length + subTasks.length, 1);

      return {
        id: sub.id,
        user_id: sub.user_id,
        name: sub.name,
        target_topics: totalTopics,
        total_topics: totalTopics,
        completed_topics: completedTopics,
        created_at: sub.created_at,
        updated_at: sub.created_at,
      };
    });

    const subjectGoals: SubjectGoal[] = (subjectsData || []).map((sub) => {
      const sTopics = (topicsData || []).filter((t) => t.subject_id === sub.id);
      const metaTopic = sTopics.find((t) => t.title.startsWith(GOAL_META_PREFIX));

      let goalTitle = `Master ${sub.name}`;
      let target = 15;
      let completed = 0;
      let status: GoalStatus = "Not Started";
      let notes: string | null = null;

      if (metaTopic) {
        const parsed = parseGoalMetaTopic(metaTopic.title);
        goalTitle = parsed.goal_title || goalTitle;
        target = parsed.target_topics || target;
        completed = parsed.completed_topics || 0;
        status = parsed.status || "Not Started";
        notes = parsed.notes || null;
      } else {
        const regularTopics = sTopics.filter((t) => !t.title.startsWith(GOAL_META_PREFIX));
        completed = regularTopics.filter((t) => t.completed).length;
        target = regularTopics.length > 0 ? regularTopics.length : 15;
      }

      const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
      const resolvedStatus: GoalStatus = pct >= 100 ? "Completed" : completed > 0 ? "In Progress" : status;

      return {
        id: sub.id,
        user_id: sub.user_id,
        subject_id: sub.id,
        subject_name: sub.name,
        goal_title: goalTitle,
        target_topics: target,
        completed_topics: completed,
        progress_percentage: pct,
        status: resolvedStatus,
        notes,
        created_at: sub.created_at,
        updated_at: sub.created_at,
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
    const target = goal.target_topics || 15;
    const name = goal.subject_name.trim();
    const title = goal.goal_title ? goal.goal_title.trim() : `Master ${name}`;

    // 1. Upsert / insert subject
    let { data: subData } = await supabase
      .from("subjects")
      .select("*")
      .eq("user_id", userId)
      .ilike("name", name)
      .maybeSingle();

    if (!subData) {
      const insRes = await supabase
        .from("subjects")
        .insert([{ user_id: userId, name }])
        .select()
        .maybeSingle();
      if (insRes.error) {
        throw new Error(insRes.error.message);
      }
      subData = insRes.data!;
    }

    // 2. Insert goal meta in topics table
    const metaTitle = encodeGoalMetaTopic({
      goal_title: title,
      target_topics: target,
      completed_topics: 0,
      status: "Not Started",
      notes: goal.notes || null,
    });

    // Remove any existing goal meta topic for this subject
    const { data: existingTopics } = await supabase
      .from("topics")
      .select("id, title")
      .eq("subject_id", subData.id)
      .eq("user_id", userId);

    const oldMeta = (existingTopics || []).find((t) => t.title.startsWith(GOAL_META_PREFIX));
    if (oldMeta) {
      await supabase.from("topics").update({ title: metaTitle }).eq("id", oldMeta.id);
    } else {
      await supabase.from("topics").insert([
        {
          user_id: userId,
          subject_id: subData.id,
          title: metaTitle,
          completed: false,
        },
      ]);
    }

    return {
      id: subData.id,
      user_id: userId,
      subject_id: subData.id,
      subject_name: name,
      goal_title: title,
      target_topics: target,
      completed_topics: 0,
      progress_percentage: 0,
      status: "Not Started",
      notes: goal.notes || null,
      created_at: subData.created_at,
      updated_at: subData.created_at,
    };
  } catch (err: any) {
    console.error("[MBBSService] createSubjectGoal exception:", err);
    throw err;
  }
}

export async function updateSubjectGoal(
  id: string,
  userId: string,
  updates: {
    subject_name?: string | null;
    goal_title?: string | null;
    target_topics?: number | null;
    completed_topics?: number | null;
    progress_percentage?: number | null;
    status?: GoalStatus;
    notes?: string | null;
  }
): Promise<void> {
  try {
    // 1. Update subject name if changed
    if (updates.subject_name) {
      await supabase
        .from("subjects")
        .update({ name: updates.subject_name.trim() })
        .eq("id", id)
        .eq("user_id", userId);
    }

    // 2. Fetch existing topics for this subject
    const { data: existingTopics } = await supabase
      .from("topics")
      .select("*")
      .eq("subject_id", id)
      .eq("user_id", userId);

    const oldMeta = (existingTopics || []).find((t) => t.title.startsWith(GOAL_META_PREFIX));
    const parsedOld = oldMeta ? parseGoalMetaTopic(oldMeta.title) : { isGoalMeta: false };

    const target = updates.target_topics !== undefined && updates.target_topics !== null ? Number(updates.target_topics) : parsedOld.target_topics || 15;
    const completed = updates.completed_topics !== undefined && updates.completed_topics !== null ? Number(updates.completed_topics) : parsedOld.completed_topics || 0;
    const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
    const status = updates.status || (pct >= 100 ? "Completed" : completed > 0 ? "In Progress" : "Not Started");
    const goalTitle = updates.goal_title !== undefined ? updates.goal_title : parsedOld.goal_title || `Master Subject`;
    const notes = updates.notes !== undefined ? updates.notes : parsedOld.notes || null;

    const metaTitle = encodeGoalMetaTopic({
      goal_title: goalTitle,
      target_topics: target,
      completed_topics: completed,
      status,
      notes,
    });

    if (oldMeta) {
      await supabase
        .from("topics")
        .update({
          title: metaTitle,
          completed: pct >= 100,
          completed_at: pct >= 100 ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", oldMeta.id);
    } else {
      await supabase.from("topics").insert([
        {
          user_id: userId,
          subject_id: id,
          title: metaTitle,
          completed: pct >= 100,
          completed_at: pct >= 100 ? new Date().toISOString() : null,
        },
      ]);
    }
  } catch (err: any) {
    console.error("[MBBSService] updateSubjectGoal exception:", err);
    throw err;
  }
}

export async function deleteSubjectGoal(id: string, userId: string): Promise<void> {
  try {
    // Delete topics belonging to this subject
    await supabase.from("topics").delete().eq("subject_id", id).eq("user_id", userId);
    // Delete subject
    await supabase.from("subjects").delete().eq("id", id).eq("user_id", userId);
  } catch (err: any) {
    console.error("[MBBSService] deleteSubjectGoal exception:", err);
    throw err;
  }
}

/* =========================================================================
   4. STUDY STREAKS (Using study_days and study_streaks)
   ========================================================================= */

export async function recordStudyActivity(userId: string, dateStr?: string): Promise<void> {
  try {
    const studyDate = dateStr || getTodayDateString();

    // 1. Insert into study_days
    const { data: existingDay } = await supabase
      .from("study_days")
      .select("id, tasks_completed")
      .eq("user_id", userId)
      .eq("study_date", studyDate)
      .maybeSingle();

    if (existingDay) {
      await supabase
        .from("study_days")
        .update({ tasks_completed: (existingDay.tasks_completed || 0) + 1 })
        .eq("id", existingDay.id);
    } else {
      await supabase
        .from("study_days")
        .insert([{ user_id: userId, study_date: studyDate, tasks_completed: 1 }]);
    }

    // 2. Fetch all study dates to calculate streaks
    const { data: allDays } = await supabase
      .from("study_days")
      .select("study_date")
      .eq("user_id", userId);

    const dates = (allDays || []).map((d) => d.study_date).filter(Boolean);
    const uniqueDates = Array.from(new Set(dates)).sort().reverse();

    let currentStreak = 0;
    const today = getTodayDateString();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split("T")[0] || "";

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

    // Calculate longest streak
    let longestStreak = currentStreak;
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
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    }

    // 3. Upsert study_streaks table
    await supabase
      .from("study_streaks")
      .upsert([
        {
          user_id: userId,
          current_streak: currentStreak,
          longest_streak: longestStreak,
          last_study_date: studyDate,
          updated_at: new Date().toISOString(),
        },
      ]);
  } catch (err: any) {
    console.warn("[MBBSService] recordStudyActivity notice:", err);
  }
}

export async function fetchStreakStats(userId: string): Promise<StreakStats> {
  try {
    // 1. Fetch study dates from study_days
    const { data: daysData, error: daysErr } = await supabase
      .from("study_days")
      .select("study_date")
      .eq("user_id", userId)
      .order("study_date", { ascending: false });

    // 2. Fetch streak summary from study_streaks
    const { data: streakSummary } = await supabase
      .from("study_streaks")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const dates = (daysData || []).map((d) => d.study_date).filter(Boolean) as string[];
    const uniqueDates = Array.from(new Set(dates)).sort().reverse();

    if (uniqueDates.length === 0) {
      return {
        currentStreak: streakSummary?.current_streak || 0,
        longestStreak: streakSummary?.longest_streak || 0,
        totalStudyDays: 0,
        studyDates: [],
      };
    }

    const today = getTodayDateString();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split("T")[0] || "";

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

    let longestStreak = streakSummary?.longest_streak || currentStreak;
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
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    }

    return {
      currentStreak: streakSummary?.current_streak !== undefined ? Math.max(streakSummary.current_streak, currentStreak) : currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      totalStudyDays: uniqueDates.length,
      studyDates: uniqueDates,
    };
  } catch (err: any) {
    console.warn("[MBBSService] fetchStreakStats notice:", err);
    return { currentStreak: 0, longestStreak: 0, totalStudyDays: 0, studyDates: [] };
  }
}

/* =========================================================================
   5. EXAMS (Using name, exam_date, description)
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
      const parsed = parseExamDesc(ex.description);
      const sub = (subjectsData || []).find((s) => s.id === parsed.subject_id || s.name === parsed.subject_name);
      const exMs = new Date(ex.exam_date).getTime();
      const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

      return {
        id: ex.id,
        user_id: ex.user_id,
        title: ex.name,
        exam_date: ex.exam_date,
        subject_id: parsed.subject_id || (sub ? sub.id : null),
        subject_name: sub ? sub.name : parsed.subject_name || null,
        exam_type: parsed.exam_type,
        status: parsed.status || (daysRemaining < 0 ? "Completed" : "Upcoming"),
        notes: parsed.notes,
        days_remaining: daysRemaining,
        created_at: ex.created_at,
        updated_at: ex.updated_at,
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
    const examDate = exam.exam_date || getTodayDateString();
    const encodedDesc = encodeExamDesc({
      exam_type: exam.exam_type || "University Exam",
      status: exam.status || "Upcoming",
      subject_id: exam.subject_id || null,
      subject_name: exam.subject_name || null,
      notes: exam.notes || null,
    });

    const payload = {
      user_id: userId,
      name: exam.title!.trim(),
      exam_date: examDate,
      description: encodedDesc,
    };

    const { data, error } = await supabase
      .from("exams")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error) {
      console.error("[MBBSService] createExam error:", error);
      throw new Error(error.message);
    }

    const row = data!;
    const todayMs = new Date(getTodayDateString()).getTime();
    const exMs = new Date(row.exam_date).getTime();
    const daysRemaining = Math.ceil((exMs - todayMs) / (1000 * 60 * 60 * 24));

    return {
      id: row.id,
      user_id: row.user_id,
      title: row.name,
      exam_date: row.exam_date,
      subject_id: exam.subject_id || null,
      subject_name: exam.subject_name || null,
      exam_type: exam.exam_type || "University Exam",
      status: exam.status || (daysRemaining < 0 ? "Completed" : "Upcoming"),
      notes: exam.notes || null,
      days_remaining: daysRemaining,
      created_at: row.created_at,
      updated_at: row.updated_at,
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
    // Fetch existing exam to preserve existing metadata
    const { data: existing } = await supabase
      .from("exams")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    const existingParsed = parseExamDesc(existing?.description);

    const examType = updates.exam_type !== undefined ? updates.exam_type : existingParsed.exam_type;
    const status = updates.status !== undefined ? updates.status : existingParsed.status;
    const subjectId = updates.subject_id !== undefined ? updates.subject_id : existingParsed.subject_id;
    const subjectName = updates.subject_name !== undefined ? updates.subject_name : existingParsed.subject_name;
    const notes = updates.notes !== undefined ? updates.notes : existingParsed.notes;

    const payload: any = {
      updated_at: new Date().toISOString(),
      description: encodeExamDesc({
        exam_type: examType,
        status,
        subject_id: subjectId,
        subject_name: subjectName,
        notes,
      }),
    };

    if (updates.title !== undefined) payload.name = updates.title.trim();
    if (updates.exam_date !== undefined) payload.exam_date = updates.exam_date;

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
   6. STUDY NOTES (Title, content, subject_id)
   ========================================================================= */

export async function fetchNotes(userId: string, subjectId?: string): Promise<Note[]> {
  try {
    let query = supabase.from("notes").select("*").eq("user_id", userId);
    if (subjectId && subjectId.trim()) {
      query = query.eq("subject_id", subjectId.trim());
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
        id: n.id,
        user_id: n.user_id,
        title: n.title,
        content: n.content || "",
        subject_id: n.subject_id || null,
        subject_name: sub ? sub.name : null,
        created_at: n.created_at,
        updated_at: n.updated_at,
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
      subject_id: note.subject_id && note.subject_id.trim() ? note.subject_id.trim() : null,
      title: note.title!.trim(),
      content: note.content ? note.content.trim() : "",
    };

    const { data, error } = await supabase
      .from("notes")
      .insert([payload])
      .select()
      .maybeSingle();

    if (error) {
      console.error("[MBBSService] createNote error:", error);
      throw new Error(error.message);
    }

    const row = data!;
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      content: row.content || "",
      subject_id: row.subject_id || null,
      subject_name: note.subject_name || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
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
    if (updates.subject_id !== undefined) {
      payload.subject_id = updates.subject_id && updates.subject_id.trim() ? updates.subject_id.trim() : null;
    }

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
