import { useState } from "react";
import { Calendar, Plus, Trash2, Edit3, Clock, AlertCircle } from "lucide-react";
import type { Exam, Subject, SubjectGoal, ExamType, ExamStatus } from "@/types/mbbs-hub";
import { getTodayDateString } from "@/lib/mbbs-hub-service";

interface ExamTrackerProps {
  userId: string;
  exams: Exam[];
  subjects: Subject[];
  subjectGoals?: SubjectGoal[];
  onAddExam: (exam: Partial<Exam>) => Promise<void>;
  onUpdateExam: (id: string, updates: Partial<Exam>) => Promise<void>;
  onDeleteExam: (id: string) => Promise<void>;
}

export function ExamTracker({
  userId,
  exams,
  subjects,
  subjectGoals = [],
  onAddExam,
  onUpdateExam,
  onDeleteExam,
}: ExamTrackerProps) {
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [examDate, setExamDate] = useState(getTodayDateString());
  const [examType, setExamType] = useState<ExamType>("University Exam");
  const [status, setStatus] = useState<ExamStatus>("Upcoming");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // All subject options from either subjectGoals or subjects
  const subjectOptions = [
    ...subjects.map((s) => ({ id: s.id, name: s.name })),
    ...subjectGoals
      .filter((g) => !subjects.some((s) => s.name.toLowerCase() === g.subject_name.toLowerCase()))
      .map((g) => ({ id: g.subject_id || g.id, name: g.subject_name })),
  ];

  const upcomingExams = exams.filter((e) => (e.days_remaining ?? 0) >= 0 && e.status !== "Completed");
  const pastExams = exams.filter((e) => (e.days_remaining ?? 0) < 0 || e.status === "Completed");

  function handleOpenCreate() {
    setEditingExam(null);
    setTitle("");
    setSubjectId("");
    setSubjectName("");
    setExamDate(getTodayDateString());
    setExamType("University Exam");
    setStatus("Upcoming");
    setNotes("");
    setErrorMsg("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(exam: Exam) {
    setEditingExam(exam);
    setTitle(exam.title);
    setSubjectId(exam.subject_id || "");
    setSubjectName(exam.subject_name || "");
    setExamDate(exam.exam_date);
    setExamType(exam.exam_type);
    setStatus(exam.status || "Upcoming");
    setNotes(exam.notes || "");
    setErrorMsg("");
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg("Please enter an exam title.");
      return;
    }
    setLoading(true);
    setErrorMsg("");

    const chosenSub = subjectOptions.find((s) => s.id === subjectId || s.name === subjectName);

    try {
      if (editingExam) {
        await onUpdateExam(editingExam.id, {
          title: title.trim(),
          subject_id: chosenSub?.id || null,
          subject_name: chosenSub?.name || (subjectName.trim() || null),
          exam_date: examDate,
          exam_type: examType,
          status,
          notes: notes.trim() || null,
        });
      } else {
        await onAddExam({
          title: title.trim(),
          subject_id: chosenSub?.id || null,
          subject_name: chosenSub?.name || (subjectName.trim() || null),
          exam_date: examDate,
          exam_type: examType,
          status,
          notes: notes.trim() || null,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save exam.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Exam Planner & Countdown</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Schedule and track University Exams, Internal Assessments, Vivas, and Quizzes with status.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="bg-gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="size-4" />
          <span>Add Exam</span>
        </button>
      </div>

      {/* Upcoming Exams Grid */}
      <div className="space-y-4">
        <h2 className="text-base font-bold sm:text-lg">Upcoming Exams ({upcomingExams.length})</h2>

        {upcomingExams.length === 0 ? (
          <div className="glass rounded-3xl p-8 text-center">
            <Calendar className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">No upcoming exams scheduled</p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              + Schedule an exam
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingExams.map((exam) => (
              <div
                key={exam.id}
                className="glass relative overflow-hidden rounded-3xl p-5 border border-border/40 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[10px] font-bold text-indigo-500">
                      {exam.exam_type}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        exam.status === "Completed"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : exam.status === "Postponed"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-secondary text-foreground"
                      }`}
                    >
                      {exam.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(exam)}
                      className="glass flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <Edit3 className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteExam(exam.id)}
                      className="glass flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-bold">{exam.title}</h3>
                  {exam.subject_name && (
                    <p className="text-xs font-medium text-primary mt-0.5">{exam.subject_name}</p>
                  )}
                  {exam.notes && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{exam.notes}</p>}
                </div>

                <div className="flex items-center justify-between border-t border-border/40 pt-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(exam.exam_date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>

                  <span className="rounded-xl bg-gradient-brand px-3 py-1 text-xs font-extrabold text-brand-foreground shadow-sm">
                    {exam.days_remaining === 0 ? "TODAY!" : `${exam.days_remaining} DAYS LEFT`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Past / Completed Exams Section */}
      {pastExams.length > 0 && (
        <div className="space-y-3 pt-4">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
            Completed / Past Exams ({pastExams.length})
          </h2>
          <div className="space-y-2">
            {pastExams.map((exam) => (
              <div
                key={exam.id}
                className="glass flex items-center justify-between rounded-2xl p-3 opacity-70"
              >
                <div>
                  <span className="text-xs font-semibold">{exam.title}</span>
                  {exam.subject_name && (
                    <span className="ml-2 text-xs text-muted-foreground">({exam.subject_name})</span>
                  )}
                  <span className="ml-2 text-[10px] text-muted-foreground">{exam.exam_date}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteExam(exam.id)}
                  className="text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">{editingExam ? "Edit Exam" : "Add New Exam"}</h2>

            {errorMsg && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Exam Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pathology University Theory Exam"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Exam Date *</label>
                  <input
                    type="date"
                    required
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Exam Type</label>
                  <select
                    value={examType}
                    onChange={(e) => setExamType(e.target.value as ExamType)}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="University Exam">University Exam</option>
                    <option value="Internal Assessment">Internal Assessment</option>
                    <option value="Viva">Viva</option>
                    <option value="Quiz">Quiz</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                    <option value="">No Associated Subject</option>
                    {subjectOptions.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ExamStatus)}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="Upcoming">Upcoming</option>
                    <option value="Completed">Completed</option>
                    <option value="Postponed">Postponed</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Notes / Syllabus (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Syllabus topics, exam hall venue, or reference questions..."
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
                  {loading ? "Saving..." : editingExam ? "Save Exam" : "Add Exam"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
