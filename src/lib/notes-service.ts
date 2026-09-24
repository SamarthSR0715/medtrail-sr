import { supabase } from "@/integrations/supabase/client";
import type { Note } from "@/types/mbbs-hub";

/**
 * Resolves a storage URL or dashboard preview link into a direct public CDN URL
 * for opening/viewing the PDF from Supabase Storage.
 */
export function resolvePdfUrl(rawUrl?: string | null): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  const trimmed = rawUrl.trim();

  const supabaseUrl =
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env["VITE_SUPABASE_URL"]) ||
    "https://jgurginsphlfdzwkitso.supabase.co";

  // Handles Supabase dashboard storage preview URLs
  // Example: https://supabase.com/dashboard/project/<id>/storage/files/buckets/Notes?path=MICROBIOLOGY/CNS-Lab+diagnosis&preview=CNS+Microbiology+.pdf
  if (trimmed.includes("supabase.com/dashboard/project/") && trimmed.includes("/storage/files/buckets/")) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/\/storage\/files\/buckets\/([^/?#]+)/);
      const bucket = match ? decodeURIComponent(match[1]) : "Notes";
      const pathParam = url.searchParams.get("path") || "";
      const previewParam = url.searchParams.get("preview") || "";

      const fullPath = [pathParam, previewParam].filter(Boolean).join("/");
      const encodedPath = fullPath
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(decodeURIComponent(segment.replace(/\+/g, " "))))
        .join("/");

      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
    } catch {
      return trimmed;
    }
  }

  // If already a full public HTTP/HTTPS URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // If it's a relative storage path (e.g. "MICROBIOLOGY/file.pdf" or "Notes/MICROBIOLOGY/file.pdf")
  let bucket = "Notes";
  let path = trimmed;
  if (trimmed.startsWith("Notes/") || trimmed.startsWith("notes/")) {
    const parts = trimmed.split("/");
    bucket = parts[0];
    path = parts.slice(1).join("/");
  }

  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(decodeURIComponent(s.replace(/\+/g, " "))))
    .join("/");

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

/**
 * Infer MBBS subject name from note properties, URL path, or title keywords
 */
export function inferSubject(note: {
  title: string;
  pdf_url?: string | null;
  subject?: string | null;
  subject_name?: string | null;
}): string {
  if (note.subject && note.subject.trim()) return note.subject.trim();
  if (note.subject_name && note.subject_name.trim()) return note.subject_name.trim();

  const textToScan = `${note.title} ${note.pdf_url || ""}`.toLowerCase();

  const MBBS_SUBJECTS: [string, string][] = [
    ["microbiology", "Microbiology"],
    ["pathology", "Pathology"],
    ["pharmacology", "Pharmacology"],
    ["anatomy", "Anatomy"],
    ["physiology", "Physiology"],
    ["biochemistry", "Biochemistry"],
    ["forensic", "Forensic Medicine"],
    ["fmt", "Forensic Medicine"],
    ["psm", "Community Medicine"],
    ["community medicine", "Community Medicine"],
    ["ophthalmology", "Ophthalmology"],
    ["ent", "ENT (Otorhinolaryngology)"],
    ["medicine", "General Medicine"],
    ["surgery", "General Surgery"],
    ["pediatrics", "Pediatrics"],
    ["paediatrics", "Pediatrics"],
    ["obstetrics", "Obstetrics & Gynaecology"],
    ["gynaecology", "Obstetrics & Gynaecology"],
    ["obgy", "Obstetrics & Gynaecology"],
    ["orthopedics", "Orthopedics"],
    ["dermatology", "Dermatology"],
    ["psychiatry", "Psychiatry"],
    ["radiology", "Radiology"],
    ["anesthesia", "Anaesthesia"],
  ];

  for (const [key, label] of MBBS_SUBJECTS) {
    if (textToScan.includes(key)) {
      return label;
    }
  }

  return "Medical Sciences";
}

/**
 * Infer MBBS Year / Semester from subject or note details
 */
export function inferSemesterYear(subjectName: string, note?: { semester?: string | null; year?: string | null }): string {
  if (note?.semester && note.semester.trim()) return note.semester.trim();
  if (note?.year && note.year.trim()) return note.year.trim();

  const sub = subjectName.toLowerCase();

  // 1st Professional (1st Year - Sem 1 & 2)
  if (sub.includes("anatomy") || sub.includes("physiology") || sub.includes("biochemistry")) {
    return "1st Year / 1st Prof";
  }

  // 2nd Professional (2nd Year - Sem 3, 4 & 5)
  if (sub.includes("microbiology") || sub.includes("pathology") || sub.includes("pharmacology")) {
    return "2nd Year / 2nd Prof";
  }

  // 3rd Professional Part 1 (3rd Year - Sem 6 & 7)
  if (sub.includes("forensic") || sub.includes("community") || sub.includes("ophthalmology") || sub.includes("ent")) {
    return "3rd Year / Part I";
  }

  // 3rd Professional Part 2 (Final Year - Sem 8 & 9)
  if (
    sub.includes("medicine") ||
    sub.includes("surgery") ||
    sub.includes("pediatrics") ||
    sub.includes("obstetrics") ||
    sub.includes("orthopedics")
  ) {
    return "Final Year / Part II";
  }

  return "MBBS Curriculum";
}

/**
 * Reusable service: Fetch all MBBS notes directly from Supabase "notes" table,
 * ordered by newest first ("created_at DESC").
 */
export async function fetchNotes(options?: {
  userId?: string;
  subjectId?: string;
}): Promise<Note[]> {
  try {
    let query = (supabase.from("notes") as any).select("*");

    if (options?.userId && options.userId.trim()) {
      query = query.eq("user_id", options.userId.trim());
    }

    if (options?.subjectId && options.subjectId.trim()) {
      query = query.eq("subject_id", options.subjectId.trim());
    }

    // Order newest first
    const { data: notesData, error: notesErr } = await query.order("created_at", { ascending: false });

    if (notesErr) {
      console.error("[notes-service] fetchNotes error:", notesErr);
      throw new Error(notesErr.message);
    }

    // Fetch subject names for foreign key mapping if any
    const { data: subjectsData } = await (supabase.from("subjects") as any).select("id, name");

    const notes: Note[] = (notesData || []).map((row: any) => {
      const matchedSubject = (subjectsData || []).find((s: any) => s.id === row.subject_id);
      const subjectName = matchedSubject ? matchedSubject.name : row.subject || null;
      const computedSubject = inferSubject({
        title: row.title,
        pdf_url: row.pdf_url,
        subject: row.subject,
        subject_name: subjectName,
      });
      const computedSemesterYear = inferSemesterYear(computedSubject, {
        semester: row.semester,
        year: row.year,
      });

      return {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        content: row.content || null,
        description: row.description || row.content || null,
        subject_id: row.subject_id || null,
        subject_name: computedSubject,
        subject: computedSubject,
        semester: computedSemesterYear,
        year: row.year || computedSemesterYear,
        pdf_url: resolvePdfUrl(row.pdf_url),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    return notes;
  } catch (err: any) {
    console.error("[notes-service] fetchNotes exception:", err);
    throw err;
  }
}
