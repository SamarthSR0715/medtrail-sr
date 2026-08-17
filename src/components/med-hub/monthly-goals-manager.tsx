import { useState } from "react";
import { Target, Plus, Trash2, Edit3, CheckCircle2, AlertCircle, Calendar } from "lucide-react";
import type { MonthlyGoal } from "@/types/med-hub";
import { getCurrentMonthString } from "@/lib/med-hub-service";

interface MonthlyGoalsManagerProps {
  userId: string;
  goals: MonthlyGoal[];
  onAddGoal: (goal: Partial<MonthlyGoal>) => Promise<void>;
  onUpdateGoal: (id: string, updates: Partial<MonthlyGoal>) => Promise<void>;
  onDeleteGoal: (id: string) => Promise<void>;
}

export function MonthlyGoalsManager({
  userId,
  goals,
  onAddGoal,
  onUpdateGoal,
  onDeleteGoal,
}: MonthlyGoalsManagerProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthString());

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<MonthlyGoal | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [month, setMonth] = useState(getCurrentMonthString());
  const [targetValue, setTargetValue] = useState(100);
  const [currentValue, setCurrentValue] = useState(0);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const filteredGoals = goals.filter((g) => g.month === selectedMonth);
  const completedCount = filteredGoals.filter((g) => g.completed).length;
  const totalCount = filteredGoals.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function handleOpenCreate() {
    setEditingGoal(null);
    setTitle("");
    setDescription("");
    setMonth(selectedMonth);
    setTargetValue(100);
    setCurrentValue(0);
    setErrorMsg("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(goal: MonthlyGoal) {
    setEditingGoal(goal);
    setTitle(goal.title);
    setDescription(goal.description || "");
    setMonth(goal.month);
    setTargetValue(goal.target_value || 100);
    setCurrentValue(goal.current_value || 0);
    setErrorMsg("");
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg("Please enter a goal title.");
      return;
    }
    setLoading(true);
    setErrorMsg("");

    try {
      if (editingGoal) {
        await onUpdateGoal(editingGoal.id, {
          title: title.trim(),
          description: description.trim() || null,
          month,
          target_value: targetValue,
          current_value: currentValue,
          completed: currentValue >= targetValue,
        });
      } else {
        await onAddGoal({
          title: title.trim(),
          description: description.trim() || null,
          month,
          target_value: targetValue,
          current_value: currentValue,
          completed: currentValue >= targetValue,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save goal.");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleCompleted(goal: MonthlyGoal) {
    const nextVal = !goal.completed;
    await onUpdateGoal(goal.id, {
      completed: nextVal,
      current_value: nextVal ? goal.target_value : 0,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Monthly Study Goals</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Set and track high-level study milestones for each month.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="bg-gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="size-4" />
          <span>Add Goal</span>
        </button>
      </div>

      {/* Month Selector Bar & Summary Banner */}
      <div className="glass flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-3xl p-5 border border-border/40">
        <div className="flex items-center gap-3">
          <Calendar className="size-5 text-primary" />
          <div>
            <span className="text-xs font-medium text-muted-foreground">Selected Month</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="mt-0.5 block rounded-xl border border-border/60 bg-background px-3 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs font-medium text-muted-foreground">Progress</span>
            <p className="text-lg font-bold text-emerald-500">
              {completedCount} / {totalCount} ({progressPct}%)
            </p>
          </div>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Goals List */}
      <div className="glass rounded-3xl p-4 sm:p-6 space-y-3">
        {filteredGoals.length === 0 ? (
          <div className="py-12 text-center">
            <Target className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">No goals created for {selectedMonth}</p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              + Set a new monthly goal
            </button>
          </div>
        ) : (
          filteredGoals.map((goal) => {
            const goalPct =
              goal.target_value > 0
                ? Math.min(100, Math.round((goal.current_value / goal.target_value) * 100))
                : 0;

            return (
              <div
                key={goal.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border/40 bg-background/50 p-4 transition-colors hover:bg-secondary/30"
              >
                <div className="flex items-start gap-3.5">
                  <input
                    type="checkbox"
                    checked={goal.completed}
                    onChange={() => handleToggleCompleted(goal)}
                    className="mt-1 size-5 rounded border-border text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                  />
                  <div className="space-y-1">
                    <h3
                      className={`text-sm font-semibold ${
                        goal.completed ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {goal.title}
                    </h3>
                    {goal.description && (
                      <p className="text-xs text-muted-foreground">{goal.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground pt-1">
                      <span>
                        Target: {goal.current_value} / {goal.target_value}
                      </span>
                      <span>•</span>
                      <span className="text-emerald-500 font-semibold">{goalPct}% Achieved</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(goal)}
                    className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <Edit3 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteGoal(goal.id)}
                    className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold">{editingGoal ? "Edit Goal" : "Add Monthly Goal"}</h2>

            {errorMsg && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Goal Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Complete 500 Pathology MCQs"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Month</label>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Target Units</label>
                  <input
                    type="number"
                    min="1"
                    value={targetValue}
                    onChange={(e) => setTargetValue(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Current Progress Units</label>
                <input
                  type="number"
                  min="0"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Details or strategy to achieve this goal..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-brand rounded-full px-5 py-2 text-xs font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {loading ? "Saving..." : editingGoal ? "Save Goal" : "Create Goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
