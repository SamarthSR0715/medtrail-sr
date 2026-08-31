import { useState } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  BarChart2,
  Check,
  Target,
} from "lucide-react";
import type { SubjectGoal, Subject, SubjectTopic, TopicStatus, PriorityLevel, GoalStatus } from "@/types/mbbs-hub";

interface SubjectGoalsManagerProps {
  userId: string;
  subjectGoals: SubjectGoal[];
  subjects: Subject[];
  topics: SubjectTopic[];
  onAddSubjectGoal: (goal: Partial<SubjectGoal>) => Promise<void>;
  onUpdateSubjectGoal: (id: string, updates: Partial<SubjectGoal>) => Promise<void>;
  onDeleteSubjectGoal: (id: string) => Promise<void>;
  onAddTopic?: (topic: Omit<SubjectTopic, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  onUpdateTopic?: (id: string, updates: Partial<SubjectTopic>) => Promise<void>;
  onDeleteTopic?: (id: string) => Promise<void>;
}

export function SubjectGoalsManager({
  userId,
  subjectGoals,
  subjects,
  topics,
  onAddSubjectGoal,
  onUpdateSubjectGoal,
  onDeleteSubjectGoal,
  onAddTopic,
  onUpdateTopic,
  onDeleteTopic,
}: SubjectGoalsManagerProps) {
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SubjectGoal | null>(null);

  // Form State
  const [subjectName, setSubjectName] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [targetTopics, setTargetTopics] = useState(15);
  const [completedTopics, setCompletedTopics] = useState(0);
  const [status, setStatus] = useState<GoalStatus>("In Progress");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Quick progress increment/decrement
  async function handleQuickAdjust(goal: SubjectGoal, delta: number) {
    const nextCompleted = Math.max(0, Math.min(goal.target_topics, goal.completed_topics + delta));
    const nextPct = goal.target_topics > 0 ? Math.round((nextCompleted / goal.target_topics) * 100) : 0;
    const nextStatus: GoalStatus = nextPct >= 100 ? "Completed" : nextCompleted > 0 ? "In Progress" : "Not Started";

    await onUpdateSubjectGoal(goal.id, {
      completed_topics: nextCompleted,
      progress_percentage: nextPct,
      status: nextStatus,
    });
  }

  function handleOpenCreate() {
    setEditingGoal(null);
    setSubjectName("");
    setGoalTitle("");
    setTargetTopics(15);
    setCompletedTopics(0);
    setStatus("In Progress");
    setNotes("");
    setErrorMsg("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(goal: SubjectGoal) {
    setEditingGoal(goal);
    setSubjectName(goal.subject_name);
    setGoalTitle(goal.goal_title || "");
    setTargetTopics(goal.target_topics || 15);
    setCompletedTopics(goal.completed_topics || 0);
    setStatus(goal.status || "In Progress");
    setNotes(goal.notes || "");
    setErrorMsg("");
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectName.trim()) {
      setErrorMsg("Please enter a subject name.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    const pct = targetTopics > 0 ? Math.min(100, Math.round((completedTopics / targetTopics) * 100)) : 0;
    const currentStatus = status || (pct >= 100 ? "Completed" : completedTopics > 0 ? "In Progress" : "Not Started");

    try {
      if (editingGoal) {
        await onUpdateSubjectGoal(editingGoal.id, {
          subject_name: subjectName.trim(),
          goal_title: goalTitle.trim() || `Master ${subjectName.trim()}`,
          target_topics: targetTopics,
          completed_topics: completedTopics,
          progress_percentage: pct,
          status: currentStatus,
          notes: notes.trim() || null,
        });
      } else {
        await onAddSubjectGoal({
          subject_name: subjectName.trim(),
          goal_title: goalTitle.trim() || `Master ${subjectName.trim()}`,
          target_topics: targetTopics,
          completed_topics: completedTopics,
          progress_percentage: pct,
          status: currentStatus,
          notes: notes.trim() || null,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save subject goal.");
    } finally {
      setLoading(false);
    }
  }

  // Calculate totals
  const totalGoals = subjectGoals.length;
  const completedGoals = subjectGoals.filter((g) => g.progress_percentage >= 100 || g.status === "Completed").length;
  const averageProgress =
    totalGoals > 0
      ? Math.round(subjectGoals.reduce((sum, g) => sum + (g.progress_percentage || 0), 0) / totalGoals)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Subject Goals & Syllabus Progress</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Set one comprehensive goal per medical subject and track syllabus progress percentage.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="bg-gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="size-4" />
          <span>Add Subject Goal</span>
        </button>
      </div>

      {/* Summary Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="glass rounded-2xl p-4">
          <span className="text-xs font-medium text-muted-foreground">Subjects Tracked</span>
          <p className="mt-1 text-2xl font-bold">{totalGoals}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <span className="text-xs font-medium text-emerald-500">Fully Mastered</span>
          <p className="mt-1 text-2xl font-bold text-emerald-500">{completedGoals}</p>
        </div>
        <div className="glass rounded-2xl p-4 col-span-2 sm:col-span-1">
          <span className="text-xs font-medium text-primary">Avg. Syllabus Progress</span>
          <p className="mt-1 text-2xl font-bold text-primary">{averageProgress}%</p>
        </div>
      </div>

      {/* Subject Goals List */}
      {subjectGoals.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <Target className="mx-auto size-12 text-muted-foreground/40" />
          <h3 className="mt-3 text-base font-semibold">No subject goals configured</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your subjects (e.g. Pathology, Pharmacology, Surgery) and set target topics to track progress.
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <Plus className="size-4" />
            <span>Create First Subject Goal</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {subjectGoals.map((goal) => {
            const pct = goal.progress_percentage || 0;
            const isCompleted = pct >= 100 || goal.status === "Completed";

            return (
              <div
                key={goal.id}
                className="glass flex flex-col justify-between rounded-3xl p-5 sm:p-6 border border-border/40 space-y-4 transition-all hover:border-primary/40 hover:shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-primary">
                        {goal.subject_name}
                      </span>
                      <h3 className="mt-1 text-lg font-bold">{goal.goal_title || `Master ${goal.subject_name}`}</h3>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(goal)}
                        className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSubjectGoal(goal.id)}
                        className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {goal.notes && (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{goal.notes}</p>
                  )}
                </div>

                {/* Progress Bar & Status Section */}
                <div className="space-y-3 border-t border-border/40 pt-4">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-muted-foreground">
                      {goal.completed_topics} of {goal.target_topics} topics done
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        isCompleted
                          ? "bg-emerald-500/15 text-emerald-500"
                          : goal.status === "In Progress"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {pct}% Complete
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full transition-all duration-500 ${
                        isCompleted ? "bg-emerald-500" : "bg-gradient-brand"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Quick Adjust Buttons (+1 / -1) */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-muted-foreground font-medium">Quick progress update:</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleQuickAdjust(goal, -1)}
                        disabled={goal.completed_topics <= 0}
                        className="glass flex size-7 items-center justify-center rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickAdjust(goal, 1)}
                        disabled={goal.completed_topics >= goal.target_topics}
                        className="glass flex size-7 items-center justify-center rounded-xl text-xs font-bold text-primary hover:bg-primary/20 transition-colors disabled:opacity-30"
                      >
                        +1
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">
              {editingGoal ? "Edit Subject Goal" : "Add New Subject Goal"}
            </h2>

            {errorMsg && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Subject Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pathology, Pharmacology, Surgery"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Goal Title / Milestone</label>
                <input
                  type="text"
                  placeholder="e.g. Finish Robbins General Pathology Chapters"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Target Topics Count</label>
                  <input
                    type="number"
                    min="1"
                    value={targetTopics}
                    onChange={(e) => setTargetTopics(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Completed Topics</label>
                  <input
                    type="number"
                    min="0"
                    max={targetTopics}
                    value={completedTopics}
                    onChange={(e) => setCompletedTopics(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as GoalStatus)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Study Notes / Syllabus Scope</label>
                <textarea
                  rows={2}
                  placeholder="Key reference books, high-yield chapters, or clinical points..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
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
