import { useState } from "react";
import {
  Flame,
  CheckSquare,
  Target,
  Calendar,
  BookOpen,
  Plus,
  ArrowRight,
  TrendingUp,
  Clock,
  Sparkles,
} from "lucide-react";
import type {
  DailyTask,
  Subject,
  SubjectTopic,
  MonthlyGoal,
  StreakStats,
  Exam,
} from "@/types/med-hub";

interface DashboardOverviewProps {
  displayName: string;
  tasks: DailyTask[];
  subjects: Subject[];
  topics: SubjectTopic[];
  goals: MonthlyGoal[];
  streakStats: StreakStats;
  exams: Exam[];
  onNavigateTab: (tab: string) => void;
  onOpenAddTaskModal: () => void;
  onOpenAddExamModal: () => void;
  onOpenAddNoteModal: () => void;
  onToggleTask: (taskId: string, completed: boolean) => void;
}

export function DashboardOverview({
  displayName,
  tasks,
  subjects,
  topics,
  goals,
  streakStats,
  exams,
  onNavigateTab,
  onOpenAddTaskModal,
  onOpenAddExamModal,
  onOpenAddNoteModal,
  onToggleTask,
}: DashboardOverviewProps) {
  // Determine greeting based on current hour
  const hour = new Date().getHours();
  let greeting = "Good morning";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon";
  if (hour >= 17) greeting = "Good evening";

  const todayDateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const completedTasks = tasks.filter((t) => t.completed).length;
  const totalTasks = tasks.length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Monthly goals calculation
  const completedGoals = goals.filter((g) => g.completed).length;
  const goalCompletionRate = goals.length > 0 ? Math.round((completedGoals / goals.length) * 100) : 0;

  // Overall subjects topics completion
  const totalSubjectTopics = subjects.reduce((acc, s) => acc + (s.total_topics || 0), 0);
  const completedSubjectTopics = subjects.reduce((acc, s) => acc + (s.completed_topics || 0), 0);
  const overallSubjectProgress =
    totalSubjectTopics > 0 ? Math.round((completedSubjectTopics / totalSubjectTopics) * 100) : 0;

  // Next upcoming exam
  const upcomingExam = exams
    .filter((e) => (e.days_remaining ?? 0) >= 0)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))[0];

  return (
    <div className="space-y-6">
      {/* Top Banner / Greeting */}
      <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8 border border-white/20 dark:border-white/10 shadow-xl">
        <div className="absolute right-0 top-0 -mr-12 -mt-12 size-56 rounded-full bg-gradient-brand opacity-10 blur-3xl" />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="size-3.5" />
              <span>Medical Student Dashboard</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting}, <span className="gradient-text">{displayName}</span>!
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{todayDateStr}</p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenAddTaskModal}
              className="bg-gradient-brand flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105"
            >
              <Plus className="size-3.5" />
              <span>Add Task</span>
            </button>
            <button
              type="button"
              onClick={onOpenAddExamModal}
              className="glass flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-foreground hover:bg-secondary/70 transition-colors"
            >
              <Calendar className="size-3.5 text-primary" />
              <span>Add Exam</span>
            </button>
            <button
              type="button"
              onClick={onOpenAddNoteModal}
              className="glass flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-foreground hover:bg-secondary/70 transition-colors"
            >
              <BookOpen className="size-3.5 text-primary" />
              <span>Add Note</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Card 1: Today's Tasks */}
        <div
          onClick={() => onNavigateTab("tasks")}
          className="glass group cursor-pointer rounded-2xl p-4 sm:p-5 transition-all hover:border-primary/40 hover:shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Today's Tasks</span>
            <span className="rounded-full bg-primary/10 p-2 text-primary">
              <CheckSquare className="size-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-bold tracking-tight">
              {completedTasks} <span className="text-sm font-normal text-muted-foreground">/ {totalTasks}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="bg-gradient-brand h-full transition-all duration-500"
                  style={{ width: `${taskCompletionRate}%` }}
                />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">{taskCompletionRate}%</span>
            </div>
          </div>
        </div>

        {/* Card 2: Study Streak */}
        <div
          onClick={() => onNavigateTab("streaks")}
          className="glass group cursor-pointer rounded-2xl p-4 sm:p-5 transition-all hover:border-amber-500/40 hover:shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Study Streak</span>
            <span className="rounded-full bg-amber-500/10 p-2 text-amber-500">
              <Flame className="size-4 animate-bounce" />
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-1 text-xl sm:text-2xl font-bold tracking-tight text-amber-500">
              <span>🔥 {streakStats.currentStreak}</span>
              <span className="text-xs font-medium text-muted-foreground">Days</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Longest: <span className="font-semibold text-foreground">{streakStats.longestStreak} days</span>
            </p>
          </div>
        </div>

        {/* Card 3: Monthly Goal */}
        <div
          onClick={() => onNavigateTab("goals")}
          className="glass group cursor-pointer rounded-2xl p-4 sm:p-5 transition-all hover:border-emerald-500/40 hover:shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Monthly Goals</span>
            <span className="rounded-full bg-emerald-500/10 p-2 text-emerald-500">
              <Target className="size-4" />
            </span>
          </div>
          <div className="mt-3">
            <div className="text-xl sm:text-2xl font-bold tracking-tight">
              {completedGoals} <span className="text-sm font-normal text-muted-foreground">/ {goals.length}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${goalCompletionRate}%` }}
                />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">{goalCompletionRate}%</span>
            </div>
          </div>
        </div>

        {/* Card 4: Next Exam */}
        <div
          onClick={() => onNavigateTab("exams")}
          className="glass group cursor-pointer rounded-2xl p-4 sm:p-5 transition-all hover:border-indigo-500/40 hover:shadow-lg"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Upcoming Exam</span>
            <span className="rounded-full bg-indigo-500/10 p-2 text-indigo-500">
              <Calendar className="size-4" />
            </span>
          </div>
          <div className="mt-3">
            {upcomingExam ? (
              <>
                <div className="truncate text-sm sm:text-base font-semibold">{upcomingExam.title}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-500">
                    {upcomingExam.days_remaining === 0
                      ? "TODAY"
                      : `${upcomingExam.days_remaining} DAYS LEFT`}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-muted-foreground">No upcoming exams</div>
                <p className="mt-1 text-[11px] text-primary">Click to schedule</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Grid: Today's Tasks & Subjects Summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Today's Planned Tasks */}
        <div className="glass rounded-3xl p-5 sm:p-6 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold sm:text-lg">Today's Study Checklist</h2>
              <p className="text-xs text-muted-foreground">
                {completedTasks} of {totalTasks} completed
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("tasks")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="size-3.5" />
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center">
              <CheckSquare className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No tasks scheduled for today</p>
              <button
                type="button"
                onClick={onOpenAddTaskModal}
                className="mt-3 text-xs font-semibold text-primary hover:underline"
              >
                + Add your first task
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-2xl border border-border/40 bg-background/50 p-3 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={(e) => onToggleTask(task.id, e.target.checked)}
                      className="size-4.5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                    />
                    <div>
                      <p
                        className={`text-sm font-medium transition-all ${
                          task.completed ? "line-through text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.subject_name && (
                          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {task.subject_name}
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-semibold ${
                            task.priority === "High"
                              ? "text-red-500"
                              : task.priority === "Medium"
                              ? "text-amber-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {task.priority} Priority
                        </span>
                        {task.estimated_minutes > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Clock className="size-2.5" />
                            {task.estimated_minutes} min
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subjects & Progress Summary */}
        <div className="glass rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold sm:text-lg">Subjects Progress</h2>
              <p className="text-xs text-muted-foreground">
                Overall: {overallSubjectProgress}% Completed
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("subjects")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <span>Planner</span>
              <ArrowRight className="size-3.5" />
            </button>
          </div>

          {subjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center">
              <BookOpen className="mx-auto size-7 text-muted-foreground/60" />
              <p className="mt-2 text-xs font-medium">No subjects added yet</p>
              <button
                type="button"
                onClick={() => onNavigateTab("subjects")}
                className="mt-2 text-xs font-semibold text-primary hover:underline"
              >
                + Add Subject
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {subjects.slice(0, 4).map((sub) => {
                const total = sub.total_topics || 0;
                const done = sub.completed_topics || 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;

                return (
                  <div key={sub.id} className="rounded-2xl border border-border/40 bg-background/50 p-3">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{sub.name}</span>
                      <span className="text-muted-foreground">
                        {done}/{total} ({pct}%)
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="bg-gradient-brand h-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
