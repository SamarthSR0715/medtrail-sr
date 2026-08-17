import { useState } from "react";
import { BookOpen, Plus, Trash2, Edit3, Search, Filter, AlertCircle, FileText } from "lucide-react";
import type { Note, Subject } from "@/types/med-hub";

interface NotesManagerProps {
  userId: string;
  notes: Note[];
  subjects: Subject[];
  onAddNote: (note: Partial<Note>) => Promise<void>;
  onUpdateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
}

export function NotesManager({
  userId,
  notes,
  subjects,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: NotesManagerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState("All");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const filteredNotes = notes.filter((note) => {
    if (selectedSubjectFilter !== "All" && note.subject_id !== selectedSubjectFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = note.title.toLowerCase().includes(q);
      const matchContent = note.content.toLowerCase().includes(q);
      if (!matchTitle && !matchContent) return false;
    }
    return true;
  });

  function handleOpenCreate() {
    setEditingNote(null);
    setTitle("");
    setContent("");
    setSubjectId("");
    setErrorMsg("");
    setIsModalOpen(true);
  }

  function handleOpenEdit(note: Note) {
    setEditingNote(note);
    setTitle(note.title);
    setContent(note.content);
    setSubjectId(note.subject_id || "");
    setErrorMsg("");
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg("Please enter a note title.");
      return;
    }
    setLoading(true);
    setErrorMsg("");

    try {
      if (editingNote) {
        await onUpdateNote(editingNote.id, {
          title: title.trim(),
          content: content.trim(),
          subject_id: subjectId || null,
        });
      } else {
        await onAddNote({
          title: title.trim(),
          content: content.trim(),
          subject_id: subjectId || null,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save note.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Personal Medical Notes</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Quick notes, clinical pearls, and high-yield study summaries.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="bg-gradient-brand flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-brand-foreground shadow-lg transition-transform hover:scale-105"
        >
          <Plus className="size-4" />
          <span>New Note</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="glass flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl p-3 sm:p-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search notes by title or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border/60 bg-background pl-9 pr-3.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="size-3.5 text-muted-foreground" />
          <select
            value={selectedSubjectFilter}
            onChange={(e) => setSelectedSubjectFilter(e.target.value)}
            className="w-full sm:w-auto rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="All">All Subjects</option>
            {subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notes Grid */}
      {filteredNotes.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <FileText className="mx-auto size-12 text-muted-foreground/40" />
          <h3 className="mt-3 text-base font-semibold">No notes found</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {searchQuery || selectedSubjectFilter !== "All"
              ? "Try adjusting your search query or subject filter."
              : "Create your first personal study note."}
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <Plus className="size-4" />
            <span>Create First Note</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              className="glass flex flex-col justify-between rounded-3xl p-5 border border-border/40 space-y-3 transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold line-clamp-1">{note.title}</h3>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(note)}
                      className="glass flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <Edit3 className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteNote(note.id)}
                      className="glass flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                {note.subject_name && (
                  <span className="inline-block rounded-md bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {note.subject_name}
                  </span>
                )}

                <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">{note.content}</p>
              </div>

              <div className="border-t border-border/40 pt-2 text-[10px] text-muted-foreground text-right">
                {note.updated_at
                  ? `Updated ${new Date(note.updated_at).toLocaleDateString()}`
                  : `Created ${new Date(note.created_at || "").toLocaleDateString()}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold">{editingNote ? "Edit Note" : "Create New Note"}</h2>

            {errorMsg && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Note Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Antibiotics Mechanism of Action"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Subject (Optional)</label>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No Subject</option>
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Note Content</label>
                <textarea
                  rows={6}
                  placeholder="Write your study notes, key points, or mnemonics here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
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
                  {loading ? "Saving..." : editingNote ? "Save Note" : "Create Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
