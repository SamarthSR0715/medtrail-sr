import { useEffect, useState } from "react";
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
  fetchSubjects,
  fetchDailyTasks,
  fetchTopics,
  fetchMonthlyGoals,
  fetchStreakStats,
  fetchExams,
  fetchNotes,
  createSubject,
  updateSubject,
  deleteSubject,
  createDailyTask,
  updateDailyTask,
  deleteDailyTask,
  createTopic,
  updateTopic,
  deleteTopic,
  createMonthlyGoal,
  updateMonthlyGoal,
  deleteMonthlyGoal,
  recordStudyActivity,
  createExam,
  updateExam,
  deleteExam,
  createNote,
  updateNote,
  deleteNote,
} from "@/lib/med-hub-service";
import type {
  Subject,
  SubjectTopic,
  DailyTask,
  MonthlyGoal,
  StreakStats,
  Exam,
  Note,
} from "@/types/med-hub";

import { DashboardOverview } from "@/components/med-hub/dashboard-overview";
import { DailyTasksManager } from "@/components/med-hub/daily-tasks-manager";
import { SubjectPlanner } from "@/components/med-hub/subject-planner";
import { MonthlyGoalsManager } from "@/components/med-hub/monthly-goals-manager";
import { StudyStreakTracker } from "@/components/med-hub/study-streak-tracker";
import { ExamTracker } from "@/components/med-hub/exam-tracker";
import { NotesManager } from "@/components/med-hub/notes-manager";
import { ProgressAnalytics } from "@/components/med-hub/progress-analytics";

export const Route = createFileRoute("/med-hub")({
  component: MedHubPage,
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

function MedHubPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [dataLoading, setDataLoading] = useState(true);

  // Data states
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<SubjectTopic[]>([]);
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

  // Load user Med Hub data
  useEffect(() => {
    if (!user) return;

    async function loadAllData() {
      setDataLoading(true);
      try {
        const [subRes, topRes, taskRes, goalRes, streakRes, examRes, noteRes] = await Promise.all([
          fetchSubjects(user!.id),
          fetchTopics(user!.id),
          fetchDailyTasks(user!.id),
          fetchMonthlyGoals(user!.id),
          fetchStreakStats(user!.id),
          fetchExams(user!.id),
          fetchNotes(user!.id),
        ]);

        setSubjects(subRes.data);
        setTopics(topRes.data);
        setTasks(taskRes.data);
        setGoals(goalRes.data);
        setStreakStats(streakRes.stats);
        setExams(examRes.data);
        setNotes(noteRes.data);
      } catch (err) {
        console.error("[MedHubPage] Error loading data:", err);
      } finally {
        setDataLoading(false);
      }
    }

    loadAllData();
  }, [user]);

  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex min-h-[75vh] flex-col items-center justify-center p-4">
        <div className="glass flex flex-col items-center gap-3 rounded-3xl p-8 shadow-xl">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Loading your Med Hub dashboard...</p>
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
            Please log in to access your personal Med Hub study workspace.
          </p>
        </div>
      </div>
    );
  }

  const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Student";

  // Tab Nav Data
  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "tasks", label: "Daily Tasks", icon: CheckSquare },
    { id: "subjects", label: "Subjects & Topics", icon: BookOpen },
    { id: "goals", label: "Monthly Goals", icon: Target },
    { id: "streaks", label: "Study Streak", icon: Flame },
    { id: "exams", label: "Exams", icon: Calendar },
    { id: "notes", label: "Notes", icon: FileText },
    { id: "analytics", label: "Analytics", icon: TrendingUp },
  ];

  // Handler Refreshes
  async function refreshData() {
    if (!user) return;
    const [subRes, topRes, taskRes, goalRes, streakRes, examRes, noteRes] = await Promise.all([
      fetchSubjects(user.id),
      fetchTopics(user.id),
      fetchDailyTasks(user.id),
      fetchMonthlyGoals(user.id),
      fetchStreakStats(user.id),
      fetchExams(user.id),
      fetchNotes(user.id),
    ]);
    setSubjects(subRes.data);
    setTopics(topRes.data);
    setTasks(taskRes.data);
    setGoals(goalRes.data);
    setStreakStats(streakRes.stats);
    setExams(examRes.data);
    setNotes(noteRes.data);
  }

  // Handlers for Tasks
  async function handleAddTask(task: Partial<DailyTask>) {
    await createDailyTask(user!.id, task);
    await refreshData();
  }

  async function handleUpdateTask(id: string, updates: Partial<DailyTask>) {
    await updateDailyTask(id, user!.id, updates);
    await refreshData();
  }

  async function handleDeleteTask(id: string) {
    await deleteDailyTask(id);
    await refreshData();
  }

  async function handleToggleTask(id: string, completed: boolean) {
    await updateDailyTask(id, user!.id, { completed });
    await refreshData();
  }

  // Handlers for Subjects & Topics
  async function handleAddSubject(name: string, targetTopics: number) {
    await createSubject(user!.id, name, targetTopics);
    await refreshData();
  }

  async function handleUpdateSubject(id: string, name: string, targetTopics?: number) {
    await updateSubject(id, name, targetTopics);
    await refreshData();
  }

  async function handleDeleteSubject(id: string) {
    await deleteSubject(id);
    await refreshData();
  }

  async function handleAddTopic(topic: Omit<SubjectTopic, "id" | "user_id" | "created_at" | "updated_at">) {
    await createTopic(user!.id, topic);
    await refreshData();
  }

  async function handleUpdateTopic(id: string, updates: Partial<SubjectTopic>) {
    await updateTopic(id, user!.id, updates);
    await refreshData();
  }

  async function handleDeleteTopic(id: string) {
    await deleteTopic(id);
    await refreshData();
  }

  // Handlers for Goals
  async function handleAddGoal(goal: Partial<MonthlyGoal>) {
    await createMonthlyGoal(user!.id, goal);
    await refreshData();
  }

  async function handleUpdateGoal(id: string, updates: Partial<MonthlyGoal>) {
    await updateMonthlyGoal(id, updates);
    await refreshData();
  }

  async function handleDeleteGoal(id: string) {
    await deleteMonthlyGoal(id);
    await refreshData();
  }

  // Handlers for Streak
  async function handleRecordTodayStreak() {
    await recordStudyActivity(user!.id);
    await refreshData();
  }

  // Handlers for Exams
  async function handleAddExam(exam: Partial<Exam>) {
    await createExam(user!.id, exam);
    await refreshData();
  }

  async function handleUpdateExam(id: string, updates: Partial<Exam>) {
    await updateExam(id, updates);
    await refreshData();
  }

  async function handleDeleteExam(id: string) {
    await deleteExam(id);
    await refreshData();
  }

  // Handlers for Notes
  async function handleAddNote(note: Partial<Note>) {
    await createNote(user!.id, note);
    await refreshData();
  }

  async function handleUpdateNote(id: string, updates: Partial<Note>) {
    await updateNote(id, updates);
    await refreshData();
  }

  async function handleDeleteNote(id: string) {
    await deleteNote(id);
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
          topics={topics}
          goals={goals}
          streakStats={streakStats}
          exams={exams}
          onNavigateTab={(t) => setActiveTab(t as TabType)}
          onOpenAddTaskModal={() => setActiveTab("tasks")}
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
          onAddTask={handleAddTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onToggleTask={handleToggleTask}
        />
      )}

      {activeTab === "subjects" && (
        <SubjectPlanner
          userId={user.id}
          subjects={subjects}
          topics={topics}
          onAddSubject={handleAddSubject}
          onUpdateSubject={handleUpdateSubject}
          onDeleteSubject={handleDeleteSubject}
          onAddTopic={handleAddTopic}
          onUpdateTopic={handleUpdateTopic}
          onDeleteTopic={handleDeleteTopic}
        />
      )}

      {activeTab === "goals" && (
        <MonthlyGoalsManager
          userId={user.id}
          goals={goals}
          onAddGoal={handleAddGoal}
          onUpdateGoal={handleUpdateGoal}
          onDeleteGoal={handleDeleteGoal}
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
          onAddNote={handleAddNote}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
        />
      )}

      {activeTab === "analytics" && (
        <ProgressAnalytics
          tasks={tasks}
          subjects={subjects}
          topics={topics}
          goals={goals}
          streakStats={streakStats}
          exams={exams}
        />
      )}
    </div>
  );
}
