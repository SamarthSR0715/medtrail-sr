import { useEffect, useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CheckSquare,
  BookOpen,
  Target,
  Flame,
  Calendar,
  FileText,
  TrendingUp,
  Loader2,
  Lock,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  ensureUserProfile,
  fetchDailyTasks,
  fetchMonthlyGoals,
  fetchSubjectsAndGoals,
  fetchStreakStats,
  fetchExams,
  fetchNotes,
  createDailyTask,
  updateDailyTask,
  deleteDailyTask,
  createMonthlyGoal,
  updateMonthlyGoal,
  deleteMonthlyGoal,
  createSubjectGoal,
  updateSubjectGoal,
  deleteSubjectGoal,
  recordStudyActivity,
  createExam,
  updateExam,
  deleteExam,
  createNote,
  updateNote,
  deleteNote,
} from "@/lib/mbbs-hub-service";
import type {
  SubjectGoal,
  Subject,
  DailyTask,
  MonthlyGoal,
  StreakStats,
  Exam,
  Note,
} from "@/types/mbbs-hub";

import { DashboardOverview } from "@/components/mbbs-hub/dashboard-overview";
import { DailyTasksManager } from "@/components/mbbs-hub/daily-tasks-manager";
import { SubjectGoalsManager } from "@/components/mbbs-hub/subject-goals-manager";
import { MonthlyGoalsManager } from "@/components/mbbs-hub/monthly-goals-manager";
import { StudyStreakTracker } from "@/components/mbbs-hub/study-streak-tracker";
import { ExamTracker } from "@/components/mbbs-hub/exam-tracker";
import { NotesManager } from "@/components/mbbs-hub/notes-manager";
import { ProgressAnalytics } from "@/components/mbbs-hub/progress-analytics";

export const Route = createFileRoute("/mbbs")({
  head: () => ({
    meta: [
      { title: "MBBS Hub — Medical Student Study Workspace | MedTrailSR" },
      {
        name: "description",
        content:
          "Functional MBBS student study hub with daily tasks, monthly goals, subject progress tracking, exam countdowns, clinical notes, and automatic study streaks.",
      },
      { property: "og:title", content: "MBBS Hub — Medical Student Study Workspace | MedTrailSR" },
      {
        property: "og:description",
        content:
          "Daily tasks, subject goals, monthly milestones, exam planners, notes, and study streaks for MBBS students.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://medtrail-sr.lovable.app/mbbs" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://medtrail-sr.lovable.app/mbbs" }],
  }),
  component: MbbsHubPage,
});

type TabType =
  | "dashboard"
  | "tasks"
  | "subjects"
  | "goals"
  | "streaks"
  | "exams"
  | "notes"
  | "analytics";

function MbbsHubPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [dataLoading, setDataLoading] = useState(true);

  // Data states
  const [subjectGoals, setSubjectGoals] = useState<SubjectGoal[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [streakStats, setStreakStats] = useState<StreakStats>({
    currentStreak: 0,
    longestStreak: 0,
    totalStudyDays: 0,
    studyDates: [],
  });
  const [exams, setExams] = useState<Exam[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  // Redirect unauthenticated user
  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/login" });
    }
  }, [authLoading, user, navigate]);

  // Refresh all data
  const refreshData = useCallback(async () => {
    if (!user) return;
    try {
      const [subsAndGoals, taskData, goalData, streakData, examData, noteData] =
        await Promise.all([
          fetchSubjectsAndGoals(user.id),
          fetchDailyTasks(user.id),
          fetchMonthlyGoals(user.id),
          fetchStreakStats(user.id),
          fetchExams(user.id),
          fetchNotes(user.id),
        ]);

      setSubjects(subsAndGoals.subjects);
      setSubjectGoals(subsAndGoals.subjectGoals);
      setTasks(taskData);
      setGoals(goalData);
      setStreakStats(streakData);
      setExams(examData);
      setNotes(noteData);
    } catch (err) {
      console.error("[MBBSHubPage] Error loading data from Supabase:", err);
    }
  }, [user]);

  // Load user data & ensure profile on mount or user change
  useEffect(() => {
    if (!user) return;

    async function loadInitial() {
      setDataLoading(true);
      try {
        await ensureUserProfile(user!);
        await refreshData();
      } catch (err) {
        console.error("[MBBSHubPage] Initial load error:", err);
      } finally {
        setDataLoading(false);
      }
    }

    loadInitial();
  }, [user, refreshData]);

  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex min-h-[75vh] flex-col items-center justify-center p-4">
        <div className="glass flex flex-col items-center gap-3 rounded-3xl p-8 shadow-xl">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Loading your MBBS Hub dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[75vh] flex-col items-center justify-center p-4">
        <div className="glass flex flex-col items-center gap-3 rounded-3xl p-8 shadow-xl text-center max-w-md">
          <Lock className="size-8 text-primary" />
          <h2 className="text-lg font-bold">Authentication Required</h2>
          <p className="text-xs text-muted-foreground">
            Please log in to access your personal MBBS Hub workspace.
          </p>
        </div>
      </div>
    );
  }

  const displayName = user.user_metadata?.["full_name"] || user.email?.split("@")[0] || "Doctor";

  // Tab Navigation Data
  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "tasks", label: "Daily Tasks", icon: CheckSquare },
    { id: "subjects", label: "Subject Goals", icon: BookOpen },
    { id: "goals", label: "Monthly Goals", icon: Target },
    { id: "streaks", label: "Study Streak", icon: Flame },
    { id: "exams", label: "Exam Planner", icon: Calendar },
    { id: "notes", label: "Study Notes", icon: FileText },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
  ];

  // ==========================================
  // Handlers for Tasks
  // ==========================================
  async function handleAddTask(task: Partial<DailyTask>) {
    const newTask = await createDailyTask(user!.id, task);
    setTasks((prev) => [newTask, ...prev.filter((t) => t.id !== newTask.id)]);
    await refreshData();
  }

  async function handleUpdateTask(id: string, updates: Partial<DailyTask>) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    await updateDailyTask(id, user!.id, updates);
    await refreshData();
  }

  async function handleDeleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await deleteDailyTask(id, user!.id);
    await refreshData();
  }

  async function handleToggleTask(id: string, completed: boolean) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed } : t))
    );
    await updateDailyTask(id, user!.id, { completed });
    await refreshData();
  }

  // ==========================================
  // Handlers for Subject Goals
  // ==========================================
  async function handleAddSubjectGoal(goal: Partial<SubjectGoal>) {
    const newGoal = await createSubjectGoal(user!.id, {
      subject_name: goal.subject_name || "",
      target_topics: goal.target_topics ?? 10,
      goal_title: goal.goal_title || null,
      notes: goal.notes || null,
    });
    setSubjectGoals((prev) => [...prev.filter((g) => g.id !== newGoal.id), newGoal]);
    await refreshData();
  }

  async function handleUpdateSubjectGoal(id: string, updates: Partial<SubjectGoal>) {
    setSubjectGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
    await updateSubjectGoal(id, user!.id, {
      subject_name: updates.subject_name || null,
      goal_title: updates.goal_title || null,
      target_topics: updates.target_topics ?? null,
      completed_topics: updates.completed_topics ?? null,
      progress_percentage: updates.progress_percentage ?? null,
      status: updates.status,
      notes: updates.notes || null,
    });
    await refreshData();
  }

  async function handleDeleteSubjectGoal(id: string) {
    setSubjectGoals((prev) => prev.filter((g) => g.id !== id));
    await deleteSubjectGoal(id, user!.id);
    await refreshData();
  }

  // ==========================================
  // Handlers for Monthly Goals
  // ==========================================
  async function handleAddMonthlyGoal(goal: Partial<MonthlyGoal>) {
    const newGoal = await createMonthlyGoal(user!.id, goal);
    setGoals((prev) => [newGoal, ...prev.filter((g) => g.id !== newGoal.id)]);
    await refreshData();
  }

  async function handleUpdateMonthlyGoal(id: string, updates: Partial<MonthlyGoal>) {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
    await updateMonthlyGoal(id, user!.id, updates);
    await refreshData();
  }

  async function handleDeleteMonthlyGoal(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    await deleteMonthlyGoal(id, user!.id);
    await refreshData();
  }

  // ==========================================
  // Handlers for Streak
  // ==========================================
  async function handleRecordTodayStreak() {
    await recordStudyActivity(user!.id);
    await refreshData();
  }

  // ==========================================
  // Handlers for Exams
  // ==========================================
  async function handleAddExam(exam: Partial<Exam>) {
    const newExam = await createExam(user!.id, exam);
    setExams((prev) => [...prev.filter((e) => e.id !== newExam.id), newExam]);
    await refreshData();
  }

  async function handleUpdateExam(id: string, updates: Partial<Exam>) {
    setExams((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
    await updateExam(id, user!.id, updates);
    await refreshData();
  }

  async function handleDeleteExam(id: string) {
    setExams((prev) => prev.filter((e) => e.id !== id));
    await deleteExam(id, user!.id);
    await refreshData();
  }

  // ==========================================
  // Handlers for Notes
  // ==========================================
  async function handleAddNote(note: Partial<Note>) {
    const newNote = await createNote(user!.id, note);
    setNotes((prev) => [newNote, ...prev.filter((n) => n.id !== newNote.id)]);
    await refreshData();
  }

  async function handleUpdateNote(id: string, updates: Partial<Note>) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...updates } : n))
    );
    await updateNote(id, user!.id, updates);
    await refreshData();
  }

  async function handleDeleteNote(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await deleteNote(id, user!.id);
    await refreshData();
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 sm:px-5 space-y-6">
      {/* Sub-Navigation Bar */}
      <div className="glass overflow-x-auto rounded-3xl p-2 border border-border/40 scrollbar-none">
        <div className="flex min-w-max items-center gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-gradient-brand text-brand-foreground shadow-md"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main View Switching */}
      {activeTab === "dashboard" && (
        <DashboardOverview
          displayName={displayName}
          tasks={tasks}
          subjects={subjects}
          subjectGoals={subjectGoals}
          topics={[]}
          goals={goals}
          streakStats={streakStats}
          exams={exams}
          onNavigateTab={(t) => setActiveTab(t as TabType)}
          onOpenAddTaskModal={() => setActiveTab("tasks")}
          onOpenAddGoalModal={() => setActiveTab("goals")}
          onOpenAddExamModal={() => setActiveTab("exams")}
          onOpenAddNoteModal={() => setActiveTab("notes")}
          onToggleTask={handleToggleTask}
        />
      )}

      {activeTab === "tasks" && (
        <DailyTasksManager
          userId={user.id}
          tasks={tasks}
          subjects={subjects}
          subjectGoals={subjectGoals}
          onAddTask={handleAddTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onToggleTask={handleToggleTask}
        />
      )}

      {activeTab === "subjects" && (
        <SubjectGoalsManager
          userId={user.id}
          subjectGoals={subjectGoals}
          subjects={subjects}
          topics={[]}
          onAddSubjectGoal={handleAddSubjectGoal}
          onUpdateSubjectGoal={handleUpdateSubjectGoal}
          onDeleteSubjectGoal={handleDeleteSubjectGoal}
          onAddTopic={async () => {}}
          onUpdateTopic={async () => {}}
          onDeleteTopic={async () => {}}
        />
      )}

      {activeTab === "goals" && (
        <MonthlyGoalsManager
          userId={user.id}
          goals={goals}
          onAddGoal={handleAddMonthlyGoal}
          onUpdateGoal={handleUpdateMonthlyGoal}
          onDeleteGoal={handleDeleteMonthlyGoal}
        />
      )}

      {activeTab === "streaks" && (
        <StudyStreakTracker stats={streakStats} onRecordToday={handleRecordTodayStreak} />
      )}

      {activeTab === "exams" && (
        <ExamTracker
          userId={user.id}
          exams={exams}
          subjects={subjects}
          subjectGoals={subjectGoals}
          onAddExam={handleAddExam}
          onUpdateExam={handleUpdateExam}
          onDeleteExam={handleDeleteExam}
        />
      )}

      {activeTab === "notes" && (
        <NotesManager
          userId={user.id}
          notes={notes}
          subjects={subjects}
          subjectGoals={subjectGoals}
          onAddNote={handleAddNote}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
        />
      )}

      {activeTab === "analytics" && (
        <ProgressAnalytics
          tasks={tasks}
          subjects={subjects}
          subjectGoals={subjectGoals}
          topics={[]}
          goals={goals}
          streakStats={streakStats}
          exams={exams}
        />
      )}
    </div>
  );
}
