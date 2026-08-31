import { TrendingUp, CheckSquare, BookOpen, Flame, Calendar, Award, Target } from "lucide-react";
import type {
  DailyTask,
  Subject,
  SubjectGoal,
  SubjectTopic,
  MonthlyGoal,
  StreakStats,
  Exam,
} from "@/types/mbbs-hub";

interface ProgressAnalyticsProps {
  tasks: DailyTask[];
  subjects: Subject[];
  subjectGoals?: SubjectGoal[];
  topics: SubjectTopic[];
  goals: MonthlyGoal[];
  streakStats: StreakStats;
  exams: Exam[];
}

export function ProgressAnalytics({
  tasks,
  subjects,
  subjectGoals = [],
  topics,
  goals,
  streakStats,
  exams,
}: ProgressAnalyticsProps) {
  const completedTasks = tasks.filter((t) => t.completed).length;
  const totalTasks = tasks.length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const completedGoals = goals.filter((g) => g.completed).length;
  const goalCompletionRate = goals.length > 0 ? Math.round((completedGoals / goals.length) * 100) : 0;

  const totalSubjectGoals = subjectGoals.length;
  const averageSubjectProgress =
    totalSubjectGoals > 0
      ? Math.round(
          subjectGoals.reduce((sum, g) => sum + (g.progress_percentage || 0), 0) / totalSubjectGoals
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Progress & Performance Analytics</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Visual insights into your MBBS study habits, subject mastery, and task completion rates.
        </p>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="glass rounded-3xl p-5 border border-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Daily Task Rate</span>
            <CheckSquare className="size-4 text-primary" />
          </div>
          <p className="text-2xl font-bold">{taskCompletionRate}%</p>
          <p className="text-[11px] text-muted-foreground">
            {completedTasks} of {totalTasks} tasks completed
          </p>
        </div>

        <div className="glass rounded-3xl p-5 border border-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Subject Mastery</span>
            <BookOpen className="size-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-500">{averageSubjectProgress}%</p>
          <p className="text-[11px] text-muted-foreground">
            Across {totalSubjectGoals} tracked subjects
          </p>
        </div>

        <div className="glass rounded-3xl p-5 border border-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Current Streak</span>
            <Flame className="size-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-500">{streakStats.currentStreak} Days</p>
          <p className="text-[11px] text-muted-foreground">Best: {streakStats.longestStreak} days</p>
        </div>

        <div className="glass rounded-3xl p-5 border border-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Monthly Goal Rate</span>
            <Award className="size-4 text-indigo-500" />
          </div>
          <p className="text-2xl font-bold text-indigo-500">{goalCompletionRate}%</p>
          <p className="text-[11px] text-muted-foreground">
            {completedGoals} of {goals.length} goals achieved
          </p>
        </div>
      </div>

      {/* Main Analytics Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Subject Goals Breakdown */}
        <div className="glass rounded-3xl p-6 space-y-4">
          <h2 className="text-base font-bold sm:text-lg flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <span>Subject Goals Breakdown</span>
          </h2>

          {subjectGoals.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No subject goals configured yet.</p>
          ) : (
            <div className="space-y-4">
              {subjectGoals.map((sub) => {
                const subPct = sub.progress_percentage || 0;
                return (
                  <div key={sub.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{sub.subject_name}</span>
                      <span className="text-muted-foreground">
                        {sub.completed_topics}/{sub.target_topics} topics ({subPct}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="bg-gradient-brand h-full transition-all duration-500"
                        style={{ width: `${subPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Monthly Goals Progress Overview */}
        <div className="glass rounded-3xl p-6 space-y-4">
          <h2 className="text-base font-bold sm:text-lg flex items-center gap-2">
            <Target className="size-4 text-emerald-500" />
            <span>Monthly Goals Performance</span>
          </h2>

          {goals.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No monthly goals created yet.</p>
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => {
                const pct =
                  goal.target_value > 0
                    ? Math.min(100, Math.round((goal.current_value / goal.target_value) * 100))
                    : 0;

                return (
                  <div key={goal.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{goal.title}</span>
                      <span className="text-emerald-500 font-bold">
                        {goal.current_value}/{goal.target_value} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
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
