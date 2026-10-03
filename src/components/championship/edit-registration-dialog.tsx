import React, { useState, useEffect } from "react";
import {
  GraduationCap,
  Layers,
  Save,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Building2,
  ShieldCheck,
  User,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { CollegeSelect } from "@/components/ui/college-select";
import {
  updateStudentRegistration,
  CHAMPIONSHIP_BATCH_CHOICES,
} from "@/lib/championship-service";

export interface EditRegistrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentCollege: string;
  currentCollegeId?: string | null | undefined;
  currentBatch: string;
  studentName?: string | undefined;
  studentEmail?: string | undefined;
  onSuccess?: (updated: {
    college: string;
    collegeId?: string | null;
    batch: string;
  }) => void;
}

export function EditRegistrationDialog({
  isOpen,
  onClose,
  currentCollege,
  currentCollegeId,
  currentBatch,
  studentName,
  studentEmail,
  onSuccess,
}: EditRegistrationDialogProps) {
  const [collegeName, setCollegeName] = useState(currentCollege || "");
  const [collegeId, setCollegeId] = useState<string | null>(currentCollegeId || null);
  const [batch, setBatch] = useState(currentBatch || "2026 Batch → Freshers");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state when dialog opens or props change
  useEffect(() => {
    if (isOpen) {
      setCollegeName(currentCollege || "");
      setCollegeId(currentCollegeId || null);
      setBatch(currentBatch || "2026 Batch → Freshers");
      setErrorMessage(null);
    }
  }, [isOpen, currentCollege, currentCollegeId, currentBatch]);

  if (!isOpen) return null;

  const hasChanges =
    collegeName.trim() !== (currentCollege || "").trim() ||
    (collegeId && collegeId !== currentCollegeId) ||
    batch !== currentBatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!collegeName.trim()) {
      setErrorMessage("Please select your medical college from the list.");
      return;
    }

    if (!batch.trim()) {
      setErrorMessage("Please select your admission year / batch.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await updateStudentRegistration({
        collegeName: collegeName.trim(),
        collegeId: collegeId || undefined,
        batch: batch.trim(),
      });

      if (!res.success) {
        setErrorMessage(res.message || "Failed to update registration details.");
        toast.error(res.message || "Failed to update registration details.");
        return;
      }

      toast.success("Registration details updated successfully!");
      if (onSuccess) {
        onSuccess({
          college: collegeName.trim(),
          collegeId: collegeId || null,
          batch: batch.trim(),
        });
      }
      onClose();
    } catch (err: any) {
      const msg = err?.message || "An unexpected error occurred.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-7 overflow-hidden text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Accent */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-40 h-40 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Edit Registration Details</h3>
              <p className="text-xs text-slate-400">
                Update your canonical college & MBBS admission year
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Identity Context Strip */}
        <div className="mt-4 p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-[10px] font-mono text-slate-500 uppercase flex items-center gap-1">
              <User className="w-3 h-3 text-slate-400" /> Student Name
            </span>
            <div className="font-semibold text-slate-200 truncate mt-0.5">
              {studentName || "Verified Competitor"}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-mono text-slate-500 uppercase flex items-center gap-1">
              <Mail className="w-3 h-3 text-slate-400" /> Account Email
            </span>
            <div className="font-mono text-slate-400 truncate mt-0.5">
              {studentEmail || "—"}
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Medical College */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5 text-blue-400" />
                Medical College <span className="text-red-400">*</span>
              </span>
              <span className="text-[10px] font-mono text-blue-400/80">
                Official NMC / DMER Master
              </span>
            </label>
            <CollegeSelect
              value={collegeName}
              selectedCollegeId={collegeId || undefined}
              onChange={(name, id) => {
                setCollegeName(name);
                setCollegeId(id || null);
              }}
              required
              placeholder="Search recognized medical college..."
            />
            <p className="text-[11px] text-slate-500">
              Rankings and college leaderboards will automatically reflect this college.
            </p>
          </div>

          {/* Admission Year / Batch */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                MBBS Admission Year / Batch <span className="text-red-400">*</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">2023–2026</span>
            </label>
            <select
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 transition cursor-pointer"
            >
              {CHAMPIONSHIP_BATCH_CHOICES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Security Notice */}
          <div className="p-3 rounded-2xl bg-blue-950/30 border border-blue-500/20 text-[11px] text-slate-400 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              Authorized change: Modifying your details synchronizes your current leaderboard
              profile and batch standing without altering your historical Pulse attempts or scores.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !hasChanges}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/50 disabled:text-slate-500 text-white font-bold text-xs shadow-lg shadow-blue-600/30 hover:shadow-blue-500/50 transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
