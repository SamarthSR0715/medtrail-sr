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
} from "lucide-react";
import type { Subject, SubjectTopic, TopicStatus, PriorityLevel } from "@/types/med-hub";

interface SubjectPlannerProps {
  userId: string;
  subjects: Subject[];
  topics: SubjectTopic[];
  onAddSubject: (name: string, targetTopics: number) => Promise<void>;
  onUpdateSubject: (id: string, name: string, targetTopics?: number) => Promise<void>;
  onDeleteSubject: (id: string) => Promise<void>;
  onAddTopic: (topic: Omit<SubjectTopic, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  onUpdateTopic: (id: string, updates: Partial<SubjectTopic>) => Promise<void>;
  onDeleteTopic: (id: string) => Promise<void>;
}

export function SubjectPlanner({
  userId,
  subjects,
  topics,
  onAddSubject,
  onUpdateSubject,
  onDeleteSubject,
  onAddTopic,
  onUpdateTopic,
  onDeleteTopic,
}: SubjectPlannerProps) {
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(
    subjects.length > 0 ? subjects[0].id : null
  );

  // Subject Modal State
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [subName, setSubName] = useState("");
  const [subTarget, setSubTarget] = useState(10);

  // Topic Modal State
  const [isTopicModalOpen, setIsTopicModalOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<SubjectTopic | null>(null);
  const [activeSubjectId, setActiveSubjectId] = useState<string>("");
  const [topicTitle, setTopicTitle] = useState("");
  const [topicStatus, setTopicStatus] = useState<TopicStatus>("Not Started");
  const [topicPriority, setTopicPriority] = useState<PriorityLevel>("Medium");
  const [topicHours, setTopicHours] = useState(1);
  const [topicNotes, setTopicNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Handlers for Subject Modal
  function handleOpenCreateSubject() {
    setEditingSubject(null);
    setSubName("");
    setSubTarget(10);
    setErrorMsg("");
    setIsSubModalOpen(true);
  }

  function handleOpenEditSubject(sub: Subject) {
    setEditingSubject(sub);
    setSubName(sub.name);
    setSubTarget(sub.target_topics || 0);
    setErrorMsg("");
    setIsSubModalOpen(true);
  }

  async function handleSubjectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subName.trim()) {
      setErrorMsg("Please enter a subject name.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    try {
      if (editingSubject) {
        await onUpdateSubject(editingSubject.id, subName.trim(), subTarget);
      } else {
        await onAddSubject(subName.trim(), subTarget);
      }
      setIsSubModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save subject.");
    } finally {
      setLoading(false);
    }
  }

  // Handlers for Topic Modal
  function handleOpenCreateTopic(subjectId: string) {
    setEditingTopic(null);
    setActiveSubjectId(subjectId);
    setTopicTitle("");
    setTopicStatus("Not Started");
    setTopicPriority("Medium");
    setTopicHours(1);
    setTopicNotes("");
    setErrorMsg("");
    setIsTopicModalOpen(true);
  }

  function handleOpenEditTopic(topic: SubjectTopic) {
    setEditingTopic(topic);
    setActiveSubjectId(topic.subject_id);
    setTopicTitle(topic.title);
    setTopicStatus(topic.status);
    setTopicPriority(topic.priority);
    setTopicHours(topic.estimated_hours || 1);
    setTopicNotes(topic.notes || "");
    setErrorMsg("");
    setIsTopicModalOpen(true);
  }

  async function handleTopicSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topicTitle.trim()) {
      setErrorMsg("Please enter a topic title.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    try {
      if (editingTopic) {
        await onUpdateTopic(editingTopic.id, {
          title: topicTitle.trim(),
          status: topicStatus,
          priority: topicPriority,
          estimated_hours: topicHours,
          notes: topicNotes.trim() || null,
        });
      } else {
        await onAddTopic({
          subject_id: activeSubjectId,
          title: topicTitle.trim(),
          status: topicStatus,
          priority: topicPriority,
          estimated_hours: topicHours,
          notes: topicNotes.trim() || null,
        });
      }
      setIsTopicModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save topic.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Subject & Topic Planner</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Organize medical subjects and track completion topic by topic.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreateSubject}
          className="bg-gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="size-4" />
          <span>Add Subject</span>
        </button>
      </div>

      {/* Subjects Accordion / Cards List */}
      {subjects.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <BookOpen className="mx-auto size-12 text-muted-foreground/40" />
          <h3 className="mt-3 text-base font-semibold">No subjects created yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your medical subjects (e.g. Pathology, Pharmacology, Microbiology) to start tracking.
          </p>
          <button
            type="button"
            onClick={handleOpenCreateSubject}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <Plus className="size-4" />
            <span>Create First Subject</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {subjects.map((sub) => {
            const isExpanded = expandedSubjectId === sub.id;
            const subTopics = topics.filter((t) => t.subject_id === sub.id);
            const completedCount = subTopics.filter((t) => t.status === "Completed").length;
            const totalCount = subTopics.length;
            const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            return (
              <div key={sub.id} className="glass overflow-hidden rounded-3xl border border-border/40">
                {/* Subject Header Bar */}
                <div
                  onClick={() => setExpandedSubjectId(isExpanded ? null : sub.id)}
                  className="flex cursor-pointer items-center justify-between p-4 sm:p-5 transition-colors hover:bg-secondary/30"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="size-5 text-primary" />
                    ) : (
                      <ChevronRight className="size-5 text-muted-foreground" />
                    )}
                    <div>
                      <h2 className="text-base font-bold sm:text-lg">{sub.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        {completedCount} of {totalCount} topics completed ({progressPct}%)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Progress Bar Badge */}
                    <div className="hidden sm:flex items-center gap-2">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="bg-gradient-brand h-full transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-primary">{progressPct}%</span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditSubject(sub);
                      }}
                      className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <Edit3 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSubject(sub.id);
                      }}
                      className="glass flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded Topic List */}
                {isExpanded && (
                  <div className="border-t border-border/40 bg-background/40 p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Topics ({totalCount})
                      </h3>
                      <button
                        type="button"
                        onClick={() => handleOpenCreateTopic(sub.id)}
                        className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                      >
                        <Plus className="size-3.5" />
                        <span>Add Topic</span>
                      </button>
                    </div>

                    {subTopics.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center">
                        <p className="text-xs font-medium text-muted-foreground">No topics added for this subject</p>
                        <button
                          type="button"
                          onClick={() => handleOpenCreateTopic(sub.id)}
                          className="mt-2 text-xs font-semibold text-primary hover:underline"
                        >
                          + Add topic
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {subTopics.map((topic) => (
                          <div
                            key={topic.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/30 bg-background/60 p-3.5 transition-colors hover:bg-secondary/40"
                          >
                            <div className="flex items-center gap-3">
                              <select
                                value={topic.status}
                                onChange={(e) =>
                                  onUpdateTopic(topic.id, { status: e.target.value as TopicStatus })
                                }
                                className={`rounded-xl px-2.5 py-1 text-xs font-semibold focus:outline-none border-none cursor-pointer ${
                                  topic.status === "Completed"
                                    ? "bg-emerald-500/15 text-emerald-500"
                                    : topic.status === "In Progress"
                                    ? "bg-amber-500/15 text-amber-500"
                                    : "bg-secondary text-muted-foreground"
                                }`}
                              >
                                <option value="Not Started">Not Started</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                              </select>

                              <div>
                                <span
                                  className={`text-sm font-medium ${
                                    topic.status === "Completed"
                                      ? "line-through text-muted-foreground"
                                      : "text-foreground"
                                  }`}
                                >
                                  {topic.title}
                                </span>
                                {topic.notes && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">{topic.notes}</p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                              {topic.estimated_hours > 0 && (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Clock className="size-3" />
                                  {topic.estimated_hours} hrs
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenEditTopic(topic)}
                                className="glass flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                              >
                                <Edit3 className="size-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteTopic(topic.id)}
                                className="glass flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Subject Modal */}
      {isSubModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold">
              {editingSubject ? "Edit Subject" : "Add New Subject"}
            </h2>

            {errorMsg && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubjectSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Subject Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pathology, Pharmacology, Surgery"
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Target Topics Count</label>
                <input
                  type="number"
                  min="1"
                  value={subTarget}
                  onChange={(e) => setSubTarget(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSubModalOpen(false)}
                  className="rounded-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-brand rounded-full px-5 py-2 text-xs font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {loading ? "Saving..." : editingSubject ? "Save Subject" : "Create Subject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Topic Modal */}
      {isTopicModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-md rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold">{editingTopic ? "Edit Topic" : "Add Topic"}</h2>

            {errorMsg && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleTopicSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Topic Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Granulomatous Inflammation"
                  value={topicTitle}
                  onChange={(e) => setTopicTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Status</label>
                  <select
                    value={topicStatus}
                    onChange={(e) => setTopicStatus(e.target.value as TopicStatus)}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Est. Hours</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={topicHours}
                    onChange={(e) => setTopicHours(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Key concepts or textbook reference..."
                  value={topicNotes}
                  onChange={(e) => setTopicNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTopicModalOpen(false)}
                  className="rounded-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-brand rounded-full px-5 py-2 text-xs font-semibold text-brand-foreground shadow-md transition-transform hover:scale-105 disabled:opacity-50"
                >
                  {loading ? "Saving..." : editingTopic ? "Save Topic" : "Add Topic"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
