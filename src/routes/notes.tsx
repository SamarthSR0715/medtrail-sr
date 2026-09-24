import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  FileText,
  Search,
  Filter,
  ExternalLink,
  Calendar,
  GraduationCap,
  RefreshCw,
  AlertCircle,
  FileCheck,
  BookOpen,
} from "lucide-react";
import { fetchNotes } from "@/lib/notes-service";
import type { Note } from "@/types/mbbs-hub";

export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { title: "MBBS Notes & Clinical Study Resources | MedTrail" },
      {
        name: "description",
        content:
          "Live MBBS study notes, high-yield summaries, CNS microbiology PDFs, and clinical review sheets by Samarth Rautrao.",
      },
    ],
  }),
  component: NotesPage,
});

function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("All");
  const [selectedYear, setSelectedYear] = useState("All");

  async function loadNotes() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNotes();
      setNotes(data);
    } catch (err: any) {
      console.error("[NotesPage] Failed to fetch notes:", err);
      setError(err?.message || "Failed to load notes from Supabase. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotes();
  }, []);

  const subjectsList = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => {
      if (n.subject) set.add(n.subject);
    });
    return Array.from(set).sort();
  }, [notes]);

  const yearsList = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => {
      if (n.semester) set.add(n.semester);
    });
    return Array.from(set).sort();
  }, [notes]);

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      if (selectedSubject !== "All" && n.subject !== selectedSubject) return false;
      if (selectedYear !== "All" && n.semester !== selectedYear) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = n.title.toLowerCase().includes(q);
        const inDesc = (n.description || "").toLowerCase().includes(q);
        const inSub = (n.subject || "").toLowerCase().includes(q);
        if (!inTitle && !inDesc && !inSub) return false;
      }

      return true;
    });
  }, [notes, selectedSubject, selectedYear, searchQuery]);

  function handleOpenNote(note: Note) {
    if (note.pdf_url) {
      window.open(note.pdf_url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/50 px-3.5 py-1 text-xs font-semibold text-primary">
            <BookOpen className="size-3.5" />
            <span>Live Supabase Notes</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            MBBS Study Notes & Resources
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Directly connected to Supabase storage. High-yield MBBS revision notes, clinical pearls,
            and subject summaries.
          </p>
        </div>

        <button
          type="button"
          onClick={loadNotes}
          disabled={loading}
          className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter / Search Controls */}
      <div className="glass flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search notes by title, topic, or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border/50 bg-background/80 pl-10 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <Filter className="size-3.5 text-muted-foreground" />
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="All">All Subjects</option>
              {subjectsList.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <GraduationCap className="size-3.5 text-muted-foreground" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="All">All Years / Semesters</option>
              {yearsList.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* State: Loading */}
      {loading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="glass flex flex-col justify-between rounded-3xl p-5 border border-border/40 space-y-4 animate-pulse"
            >
              <div className="space-y-3">
                <div className="h-32 w-full rounded-2xl bg-muted/40" />
                <div className="h-5 w-3/4 rounded bg-muted/40" />
                <div className="h-3 w-1/2 rounded bg-muted/30" />
                <div className="h-12 w-full rounded bg-muted/20" />
              </div>
              <div className="h-4 w-1/3 rounded bg-muted/30 pt-2" />
            </div>
          ))}
        </div>
      )}

      {/* State: Error */}
      {!loading && error && (
        <div className="glass rounded-3xl p-8 text-center space-y-3 border-destructive/30">
          <AlertCircle className="mx-auto size-10 text-destructive" />
          <h3 className="text-base font-bold text-foreground">Could not load study notes</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={loadNotes}
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="size-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* State: Empty */}
      {!loading && !error && filteredNotes.length === 0 && (
        <div className="glass rounded-3xl p-12 text-center space-y-3">
          <FileText className="mx-auto size-12 text-muted-foreground/30" />
          <h3 className="text-base font-semibold">No notes found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {searchQuery || selectedSubject !== "All" || selectedYear !== "All"
              ? "No study notes matched your search query or filter criteria. Try clearing filters."
              : "No notes are currently uploaded in the Supabase database. Uploading a note to your Supabase table will immediately display it here."}
          </p>
          {(searchQuery || selectedSubject !== "All" || selectedYear !== "All") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSelectedSubject("All");
                setSelectedYear("All");
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* State: Success Grid */}
      {!loading && !error && filteredNotes.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleOpenNote(note)}
              className="glass group flex flex-col justify-between rounded-3xl p-5 border border-border/40 hover:border-primary/50 transition-all duration-300 hover:shadow-xl cursor-pointer"
            >
              <div className="space-y-3.5">
                {/* PDF Thumbnail / Icon Banner */}
                <div className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-red-500/10 via-background to-primary/10 border border-border/30 group-hover:border-primary/40 transition-colors">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-red-500/15 text-red-500 shadow-md group-hover:scale-110 transition-transform">
                      <FileText className="size-6" />
                    </div>
                    <span className="text-[11px] font-semibold text-foreground/80 tracking-wide uppercase">
                      {note.pdf_url ? "PDF Document" : "Study Note"}
                    </span>
                  </div>

                  {note.pdf_url && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg">
                        <span>Open PDF</span>
                        <ExternalLink className="size-3.5" />
                      </span>
                    </div>
                  )}
                </div>

                {/* Badges: Subject & Semester/Year */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {note.subject && (
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {note.subject}
                    </span>
                  )}
                  {note.semester && (
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {note.semester}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3 className="text-base font-bold tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-2">
                  {note.title}
                </h3>

                {/* Description (if available) */}
                {note.description && (
                  <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
                    {note.description}
                  </p>
                )}
              </div>

              {/* Footer: Date & Action */}
              <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3 text-muted-foreground/70" />
                  <span>
                    {new Date(note.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </span>

                {note.pdf_url ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                    <span>View PDF</span>
                    <ExternalLink className="size-3" />
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <FileCheck className="size-3" />
                    <span>Read</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
