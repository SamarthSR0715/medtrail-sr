import { useState } from "react";
import { CheckSquare, Plus, Trash2, Edit3, Clock, AlertCircle, Filter, Calendar } from "lucide-react";
import type { DailyTask, Subject, SubjectGoal, PriorityLevel } from "@/types/mbbs-hub";
import { getTodayDateString } from "@/lib/mbbs-hub-service";

interface DailyTasksManagerProps {
  userId: string;
  tasks: DailyTask[];
  subjects: Subject[];
  subjectGoals?: SubjectGoal[];
  onAddTask: (task: Partial<DailyTask>) => Promise<void>;
  onUpdateTask: (id: string, updates: Partial<DailyTask>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onToggleTask: (id: string, completed: boolean) => Promise<void>;
}

export function DailyTasksManager({
  userId,
  tasks,
  subjects,
  subjectGoals = [],
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onToggleTask,
}: DailyTasksManagerProps) {
  const [filterPriority, setFilterPriority] = useState<string>("All");
  const [filterSubject, setFilterSubject] = useState<string>("All");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskDate, setTaskDate] = useState(getTodayDateString());
  const [priority, setPriority] = useState<PriorityLevel>("Medium");
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // All subject options from either subjectGoals or subjects
  const subjectOptions = [
    ...subjects.map((s) => ({ id: s.id, name: s.name })),
    ...subjectGoals
      .filter((g) => !subjects.some((s) => s.name.toLowerCase() === g.subject_name.toLowerCase()))
      .map((g) => ({ id: g.subject_id || g.id, name: g.subject_name })),
  ];

  const filteredTasks = tasks.filter((t) => {
    if (filterPriority !== "All" && t.priority !== filterPriority) return false;
    if (filterSubject !== "All" && t.subject_id !== filterSubject && t.subject_name !== filterSubject) return false;
    return true;
  });

  const completedCount = filteredTasks.filter((t) => t.completed).length;
  const totalCount = filteredTasks.length;
  const remainingCount = totalCount - completedCount;
  const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function handleOpenCreate() {
    setEditingTask(null);
    setTitle("");
    setDescription("");
    setTaskDate(getTodayDateString());
    setPriority("Medium");
    setSubjectId("");
    setSubjectName("");
    setEstimatedMinutes(30);
    setErrorMsg("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(task: DailyTask) {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description || "");
    setTaskDate(task.task_date);
    setPriority(task.priority);
    setSubjectId(task.subject_id || "");
    setSubjectName(task.subject_name || "");
    setEstimatedMinutes(task.estimated_minutes || 30);
    setErrorMsg("");
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg("Please enter a task title.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    const chosenSub = subjectOptions.find((s) => s.id === subjectId || s.name === subjectName);

    try {
      if (editingTask) {
        await onUpdateTask(editingTask.id, {
          title: title.trim(),
          description: description.trim() || null,
          task_date: taskDate,
          priority,
          subject_id: chosenSub?.id || null,
          subject_name: chosenSub?.name || (subjectName.trim() || null),
          estimated_minutes: estimatedMinutes,
        });
      } else {
        await onAddTask({
          title: title.trim(),
          description: description.trim() || null,
          task_date: taskDate,
          priority,
          subject_id: chosenSub?.id || null,
          subject_name: chosenSub?.name || (subjectName.trim() || null),
          estimated_minutes: estimatedMinutes,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error("[DailyTasksManager] Error saving task:", err);
      setErrorMsg(err?.message || "Task could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Overview Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Daily Study Tasks</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Manage, prioritize, and check off daily study items to keep your streak burning.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="bg-gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="size-4" />
          <span>Add Task</span>
        </button>
      </div>

      {/* Task Counter Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="glass rounded-2xl p-4">
          <span className="text-xs font-medium text-muted-foreground">Total Tasks</span>
          <p className="mt-1 text-2xl font-bold">{totalCount}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <span className="text-xs font-medium text-emerald-500">Completed</span>
          <p className="mt-1 text-2xl font-bold text-emerald-500">{completedCount}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <span className="text-xs font-medium text-amber-500">Remaining</span>
          <p className="mt-1 text-2xl font-bold text-amber-500">{remainingCount}</p>
        </div>
        <div className="glass rounded-2xl p-4">
          <span className="text-xs font-medium text-primary">Completion %</span>
          <p className="mt-1 text-2xl font-bold text-primary">{completionPct}%</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3 sm:p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Filter className="size-3.5" />
          <span>Filters:</span>
        </div>

        {/* Priority Filter */}
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="All">All Priorities</option>
          <option value="High">High Priority</option>
          <option value="Medium">Medium Priority</option>
          <option value="Low">Low Priority</option>
        </select>

        {/* Subject Filter */}
        <select
          value={filterSubject}
          onChange={(e) => setFilterSubject(e.target.value)}
          className="rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="All">All Subjects</option>
          {subjectOptions.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tasks List */}
      <div className="glass rounded-3xl p-4 sm:p-6 space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="py-12 text-center">
            <CheckSquare className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">No tasks found matching your filters</p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              + Create a new study task
            </button>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <div
              key={task.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/40 bg-background/50 p-4 transition-all hover:bg-secondary/30"
            >
              <div className="flex items-start gap-3.5">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={(e) => onToggleTask(task.id, e.target.checked)}
                  className="mt-0.5 size-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
                <div>
                  <h3
                    className={`text-sm font-semibold transition-all ${
                      task.completed ? "line-through text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {task.title}
                  </h3>
                  {task.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {task.subject_name && (
                      <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-foreground">
                        {task.subject_name}
                      </span>
                    )}
                    <span
                      className={`rounded-md px-2 py-0.5 font-semibold ${
                        task.priority === "High"
                          ? "bg-red-500/10 text-red-500"
                          : task.priority === "Medium"
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {task.priority} Priority
                    </span>
                    {task.estimated_minutes > 0 && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="size-3" />
                        {task.estimated_minutes} min
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => handleOpenEdit(task)}
                  className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <Edit3 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTask(task.id)}
                  className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Dialog for Add / Edit */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold">
              {editingTask ? "Edit Study Task" : "Add New Study Task"}
            </h2>

            {errorMsg && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Read Inflammation Chapter 3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Est. Time (min)</label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Subject (Optional)</label>
                <select
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value);
                    const sel = subjectOptions.find((s) => s.id === e.target.value);
                    if (sel) setSubjectName(sel.name);
                  }}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No Subject Associated</option>
                  {subjectOptions.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Key concepts, page numbers, or learning points..."
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
                  {loading ? "Saving..." : editingTask ? "Save Changes" : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
