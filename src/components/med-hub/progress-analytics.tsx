import { TrendingUp, CheckSquare, BookOpen, Flame, Calendar, Award } from "lucide-react";
import type {
  DailyTask,
  Subject,
  SubjectTopic,
  MonthlyGoal,
  StreakStats,
  Exam,
} from "@/types/med-hub";

interface ProgressAnalyticsProps {
  tasks: DailyTask[];
  subjects: Subject[];
  topics: SubjectTopic[];
  goals: MonthlyGoal[];
  streakStats: StreakStats;
  exams: Exam[];
}

export function ProgressAnalytics({
  tasks,
  subjects,
  topics,
  goals,
  streakStats,
  exams,
}: ProgressAnalyticsProps) {
  const completedTasks = tasks.filter((t) => t.completed).length;
  const totalTasks = tasks.length;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const completedTopics = topics.filter((t) => t.status === "Completed").length;
  const inProgressTopics = topics.filter((t) => t.status === "In Progress").length;
  const notStartedTopics = topics.filter((t) => t.status === "Not Started").length;
  const totalTopics = topics.length;
  const topicCompletionRate = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

  const completedGoals = goals.filter((g) => g.completed).length;
  const goalCompletionRate = goals.length > 0 ? Math.round((completedGoals / goals.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Progress & Performance Analytics</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Visual insights into your study habits, topic mastery, and task completion rates.
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
          <p className="text-[11px] text-muted-foreground">{completedTasks} of {totalTasks} tasks completed</p>
        </div>

        <div className="glass rounded-3xl p-5 border border-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Topic Mastery</span>
            <BookOpen className="size-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-500">{topicCompletionRate}%</p>
          <p className="text-[11px] text-muted-foreground">{completedTopics} of {totalTopics} topics finished</p>
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
          <p className="text-[11px] text-muted-foreground">{completedGoals} of {goals.length} goals achieved</p>
        </div>
      </div>

      {/* Main Analytics Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Subject Breakdown */}
        <div className="glass rounded-3xl p-6 space-y-4">
          <h2 className="text-base font-bold sm:text-lg flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <span>Subject Completion Breakdown</span>
          </h2>

          {subjects.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No subjects created yet.</p>
          ) : (
            <div className="space-y-4">
              {subjects.map((sub) => {
                const subTopics = topics.filter((t) => t.subject_id === sub.id);
                const subDone = subTopics.filter((t) => t.status === "Completed").length;
                const subTotal = subTopics.length;
                const subPct = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0;

                return (
                  <div key={sub.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{sub.name}</span>
                      <span className="text-muted-foreground">
                        {subDone}/{subTotal} ({subPct}%)
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

        {/* Topic Status Breakdown */}
        <div className="glass rounded-3xl p-6 space-y-4">
          <h2 className="text-base font-bold sm:text-lg flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-500" />
            <span>Topic Status Overview</span>
          </h2>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-emerald-500">Completed Topics</span>
                <span>{completedTopics} ({topicCompletionRate}%)</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${topicCompletionRate}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-amber-500">In Progress Topics</span>
                <span>
                  {inProgressTopics} (
                  {totalTopics > 0 ? Math.round((inProgressTopics / totalTopics) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-amber-500 transition-all duration-500"
                  style={{
                    width: `${
                      totalTopics > 0 ? Math.round((inProgressTopics / totalTopics) * 100) : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-muted-foreground">Not Started Topics</span>
                <span>
                  {notStartedTopics} (
                  {totalTopics > 0 ? Math.round((notStartedTopics / totalTopics) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-muted-foreground/40 transition-all duration-500"
                  style={{
                    width: `${
                      totalTopics > 0 ? Math.round((notStartedTopics / totalTopics) * 100) : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
