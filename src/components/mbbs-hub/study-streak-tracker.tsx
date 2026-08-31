import { Flame, Trophy, Calendar, CheckCircle2, Sparkles } from "lucide-react";
import type { StreakStats } from "@/types/mbbs-hub";
import { getTodayDateString } from "@/lib/mbbs-hub-service";

interface StudyStreakTrackerProps {
  stats: StreakStats;
  onRecordToday: () => Promise<void>;
}

export function StudyStreakTracker({ stats, onRecordToday }: StudyStreakTrackerProps) {
  const todayStr = getTodayDateString();
  const hasStudiedToday = stats.studyDates.includes(todayStr);

  // Generate last 30 days grid
  const last30Days: { dateStr: string; label: string; active: boolean }[] = [];
  const todayDate = new Date();

  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(todayDate.getDate() - i);
    const dateStr = d.toISOString().split("T")[0] || "";
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const active = stats.studyDates.includes(dateStr);
    last30Days.push({ dateStr, label, active });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Study Streak Tracker</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Consistency is everything in medical school. Checking off any daily task automatically logs your streak!
          </p>
        </div>
        <button
          type="button"
          onClick={onRecordToday}
          disabled={hasStudiedToday}
          className={`flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold shadow-lg transition-transform ${
            hasStudiedToday
              ? "bg-emerald-500/20 text-emerald-500 cursor-default"
              : "bg-gradient-brand text-brand-foreground hover:scale-105"
          }`}
        >
          <Flame className="size-4" />
          <span>{hasStudiedToday ? "Studied Today ✓" : "Log Today's Study"}</span>
        </button>
      </div>

      {/* Main Stats Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Current Streak Card */}
        <div className="glass rounded-3xl p-6 border border-amber-500/30 text-center space-y-2">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
            <Flame className="size-6 animate-bounce" />
          </div>
          <div className="text-3xl font-extrabold text-amber-500">{stats.currentStreak} Days</div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current Streak</p>
        </div>

        {/* Longest Streak Card */}
        <div className="glass rounded-3xl p-6 border border-emerald-500/30 text-center space-y-2">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
            <Trophy className="size-6" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-500">{stats.longestStreak} Days</div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Longest Streak</p>
        </div>

        {/* Total Days Card */}
        <div className="glass rounded-3xl p-6 border border-indigo-500/30 text-center space-y-2">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
            <Calendar className="size-6" />
          </div>
          <div className="text-3xl font-extrabold text-indigo-500">{stats.totalStudyDays} Days</div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Active Days</p>
        </div>
      </div>

      {/* 30-Day Activity Heatmap Grid */}
      <div className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold sm:text-lg flex items-center gap-2">
            <Sparkles className="size-4 text-amber-500" />
            <span>Last 30 Days Activity Grid</span>
          </h2>
          <span className="text-xs font-medium text-muted-foreground">
            {last30Days.filter((d) => d.active).length} of 30 days active
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10 sm:gap-3">
          {last30Days.map((day) => (
            <div
              key={day.dateStr}
              title={`${day.label}: ${day.active ? "Studied ✓" : "No activity recorded"}`}
              className={`flex flex-col items-center justify-center rounded-2xl p-2.5 transition-all ${
                day.active
                  ? "bg-amber-500 text-white shadow-md scale-105"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary"
              }`}
            >
              <span className="text-[10px] font-semibold">{day.label}</span>
              {day.active ? (
                <Flame className="mt-1 size-3.5" />
              ) : (
                <div className="mt-1.5 size-1.5 rounded-full bg-muted-foreground/30" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
