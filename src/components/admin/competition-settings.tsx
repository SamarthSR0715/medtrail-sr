/**
 * CompetitionSettings — Admin Panel Component (v2)
 *
 * Controls:
 * ① Date pickers for season start/end
 * ② Pulse status controls: Start Pulse / Pause Pulse / End Pulse
 * ③ Publish / Hide Results toggle
 * ④ Reset Leaderboard (clears leaderboard_reset_at marker)
 *
 * All changes propagate to all connected students in real time via
 * Supabase Realtime on the championship_settings table.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Play,
  Pause,
  Square,
  Eye,
  EyeOff,
  RotateCcw,
  Zap,
} from "lucide-react";
import {
  fetchCompetitionSettings,
  saveCompetitionSetting,
  savePulseSettingsRecord,
  subscribeToCompetitionSettings,
  setPulseStatus,
  setResultsPublished,
  resetLeaderboard,
  utcToISTLocal,
  istLocalToUTC,
  formatCompetitionDate,
  formatCompetitionDateTime,
  type CompetitionSettings,
  type PulseStatus,
} from "@/lib/competition-settings-service";

interface CompetitionSettingsProps {
  adminEmail?: string | undefined;
}

export function CompetitionSettings({ adminEmail }: CompetitionSettingsProps) {
  const [settings, setSettings] = useState<CompetitionSettings>({
    competition_date: null,
    competition_end_date: null,
    start_time: "19:00",
    end_time: "23:59",
    pulse_status: "upcoming",
    results_published: false,
    leaderboard_reset_at: null,
  });

  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingStart, setIsSavingStart] = useState(false);
  const [isSavingEnd, setIsSavingEnd] = useState(false);
  const [isClearingStart, setIsClearingStart] = useState(false);
  const [isClearingEnd, setIsClearingEnd] = useState(false);
  const [isSettingStatus, setIsSettingStatus] = useState(false);
  const [isTogglingResults, setIsTogglingResults] = useState(false);
  const [isResettingLeaderboard, setIsResettingLeaderboard] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await fetchCompetitionSettings();
      setSettings(data);
      setStartLocal(utcToISTLocal(data.competition_date));
      setEndLocal(utcToISTLocal(data.competition_end_date));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    const unsub = subscribeToCompetitionSettings((newSettings) => {
      setSettings(newSettings);
      setStartLocal(utcToISTLocal(newSettings.competition_date));
      setEndLocal(utcToISTLocal(newSettings.competition_end_date));
    });

    return () => {
      unsub();
    };
  }, []);

  // ── Date saving ─────────────────────────────────────────────────────────────
  const handleSaveStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startLocal) { toast.error("Select a start date & time."); return; }
    setIsSavingStart(true);
    try {
      const utcISO = istLocalToUTC(startLocal);
      const [datePart, timePart] = startLocal.split("T");

      // Direct update to pulse_settings row 1 / singleton
      await savePulseSettingsRecord({
        competition_date: datePart,
        start_time: timePart || "19:00",
      });

      const res = await saveCompetitionSetting("competition_date", utcISO, adminEmail);
      if (res.success) {
        toast.success("Competition date updated");
        setLastAction(`Competition date set to ${formatCompetitionDateTime(utcISO)}`);
        // Use local updated state immediately
        setSettings((prev) => ({
          ...prev,
          competition_date: utcISO,
          start_time: timePart || "19:00",
        }));
      } else {
        toast.error(`Save failed: ${res.error}`);
      }
    } finally { setIsSavingStart(false); }
  };

  const handleSaveEnd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endLocal) { toast.error("Select an end date & time."); return; }
    setIsSavingEnd(true);
    try {
      const utcISO = istLocalToUTC(endLocal);
      const [, timePart] = endLocal.split("T");

      // Direct update to pulse_settings
      await savePulseSettingsRecord({
        end_time: timePart || "23:59",
      });

      const res = await saveCompetitionSetting("competition_end_date", utcISO, adminEmail);
      if (res.success) {
        toast.success("✅ End date saved — all student views updated instantly.");
        setLastAction(`End date set to ${formatCompetitionDateTime(utcISO)}`);
        // Use local updated state immediately
        setSettings((prev) => ({
          ...prev,
          competition_end_date: utcISO,
          end_time: timePart || "23:59",
        }));
      } else {
        toast.error(`Save failed: ${res.error}`);
      }
    } finally { setIsSavingEnd(false); }
  };

  const handleClearStart = async () => {
    if (!window.confirm("Clear start date? Students will see 'Competition date will be announced.'")) return;
    setIsClearingStart(true);
    try {
      await savePulseSettingsRecord({ competition_date: null });
      const res = await saveCompetitionSetting("competition_date", null, adminEmail);
      if (res.success) {
        toast.info("Start date cleared. Site shows 'TBA'.");
        setStartLocal("");
        // Use local updated state immediately
        setSettings((prev) => ({
          ...prev,
          competition_date: null,
        }));
      }
    } finally { setIsClearingStart(false); }
  };

  const handleClearEnd = async () => {
    if (!window.confirm("Clear end date?")) return;
    setIsClearingEnd(true);
    try {
      await savePulseSettingsRecord({ end_time: "23:59" });
      const res = await saveCompetitionSetting("competition_end_date", null, adminEmail);
      if (res.success) {
        toast.info("End date cleared.");
        setEndLocal("");
        // Use local updated state immediately
        setSettings((prev) => ({
          ...prev,
          competition_end_date: null,
          end_time: "23:59",
        }));
      }
    } finally { setIsClearingEnd(false); }
  };

  // ── Pulse status controls ───────────────────────────────────────────────────
  const handleSetStatus = async (status: PulseStatus) => {
    setIsSettingStatus(true);
    try {
      // 1. Await the direct Supabase update on pulse_settings
      const { error } = await (supabase as any)
        .from("pulse_settings")
        .update({ pulse_status: status })
        .eq("id", 1);

      if (error) {
        console.error("[CompetitionSettings] Error updating pulse_status:", error);
        toast.error(`Status update failed: ${error.message}`);
        return;
      }

      // 2. Update local state immediately
      setSettings((prev) => ({
        ...prev,
        pulse_status: status,
      }));

      const labels: Record<PulseStatus, string> = {
        upcoming: "🕒 Pulse set to Upcoming",
        live: "🔴 Pulse is now LIVE — students can compete!",
        paused: "⏸️ Pulse paused",
        ended: "🏁 Pulse ended",
      };
      toast.success(labels[status]);
      setLastAction(labels[status]);

      // Secondary sync in background without blocking
      saveCompetitionSetting("pulse_status", status, adminEmail).catch(() => {});
    } catch (err: any) {
      toast.error(`Status update failed: ${err?.message || err}`);
    } finally {
      setIsSettingStatus(false);
    }
  };

  // ── Results toggle ──────────────────────────────────────────────────────────
  const handleToggleResults = async () => {
    const next = !settings.results_published;
    if (next && !window.confirm("Publish final results? Students will immediately see the leaderboard.")) return;
    setIsTogglingResults(true);
    try {
      // 1. Await the direct Supabase update on pulse_settings
      const { error } = await (supabase as any)
        .from("pulse_settings")
        .update({ results_published: next })
        .eq("id", 1);

      if (error) {
        console.error("[CompetitionSettings] Error updating results_published:", error);
        toast.error(`Toggle failed: ${error.message}`);
        return;
      }

      // 2. Update local state immediately
      setSettings((prev) => ({
        ...prev,
        results_published: next,
      }));

      toast.success(next ? "📊 Results published! Students can now see the leaderboard." : "🙈 Results hidden. Students see 'Results will be announced.'");
      setLastAction(next ? "Results published" : "Results hidden");

      // Secondary sync in background without blocking
      saveCompetitionSetting("results_published", String(next), adminEmail).catch(() => {});
    } catch (err: any) {
      toast.error(`Toggle failed: ${err?.message || err}`);
    } finally {
      setIsTogglingResults(false);
    }
  };

  // ── Leaderboard reset ───────────────────────────────────────────────────────
  const handleResetLeaderboard = async () => {
    setIsResettingLeaderboard(true);
    try {
      const res = await resetLeaderboard(adminEmail);
      if (res.success) {
        toast.success("♻️ Leaderboard reset marker saved. Students will see the cleared leaderboard.");
        setLastAction("Leaderboard reset");
        setShowResetConfirm(false);
        setSettings((prev) => ({
          ...prev,
          leaderboard_reset_at: new Date().toISOString(),
        }));
      } else {
        toast.error(`Reset failed: ${res.error}`);
      }
    } finally { setIsResettingLeaderboard(false); }
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const startDisplay = formatCompetitionDate(settings.competition_date);
  const endDisplay = formatCompetitionDate(settings.competition_end_date);

  const statusConfig: Record<PulseStatus, { label: string; color: string; bg: string; border: string }> = {
    upcoming: { label: "Upcoming", color: "text-blue-300", bg: "bg-blue-500/10", border: "border-blue-500/40" },
    live:     { label: "🔴 LIVE",  color: "text-red-300",  bg: "bg-red-500/10",  border: "border-red-500/40"  },
    paused:   { label: "Paused",  color: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/40" },
    ended:    { label: "Ended",   color: "text-slate-300", bg: "bg-slate-800",   border: "border-slate-700"   },
  };
  const current = statusConfig[settings.pulse_status];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white">Pulse & Competition Settings</h2>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic dates, real-time Pulse controls, results visibility, and leaderboard management. Changes propagate instantly without page reload.
          </p>
        </div>
        <button
          onClick={loadSettings}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-bold transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/30">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-200 leading-relaxed">
          <strong className="text-blue-300">Times are entered in IST (UTC+5:30)</strong> and stored as UTC.
          The countdown, hero section, leaderboard, and quiz lock/unlock all read from these settings in real time.
          {lastAction && <span className="ml-2 text-emerald-400 font-semibold">Last: {lastAction}</span>}
        </div>
      </div>

      {/* Current Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-amber-500/30 space-y-1.5">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">Start Date</div>
          {startDisplay
            ? <div className="text-sm font-black text-white">{startDisplay}</div>
            : <div className="text-xs text-slate-500 italic">Not set (TBA)</div>
          }
          {settings.competition_date && (
            <div className="text-[10px] text-slate-500 font-mono">{settings.competition_date}</div>
          )}
        </div>
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-indigo-500/30 space-y-1.5">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-400">End Date</div>
          {endDisplay
            ? <div className="text-sm font-black text-white">{endDisplay}</div>
            : <div className="text-xs text-slate-500 italic">Not set</div>
          }
          {settings.competition_end_date && (
            <div className="text-[10px] text-slate-500 font-mono">{settings.competition_end_date}</div>
          )}
        </div>
        <div className={`p-4 rounded-2xl space-y-1.5 border ${current.bg} ${current.border}`}>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">Pulse Status</div>
          <div className={`text-sm font-black ${current.color}`}>{current.label}</div>
          <div className="text-[10px] text-slate-500">
            Results: {settings.results_published ? "✅ Published" : "🙈 Hidden"}
          </div>
        </div>
      </div>

      {/* ── SECTION 1: Pulse Controls ── */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-700/50 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-red-500/20 border border-red-500/30">
            <Zap className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Pulse Status Controls</h3>
            <p className="text-xs text-slate-400">Manually control the competition phase for all students.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Start Pulse */}
          <button
            onClick={() => handleSetStatus("live")}
            disabled={isSettingStatus || settings.pulse_status === "live"}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group"
          >
            <Play className="w-6 h-6 group-hover:scale-110 transition-transform" />
            Start Pulse
          </button>

          {/* Pause Pulse */}
          <button
            onClick={() => handleSetStatus("paused")}
            disabled={isSettingStatus || settings.pulse_status === "paused"}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group"
          >
            <Pause className="w-6 h-6 group-hover:scale-110 transition-transform" />
            Pause Pulse
          </button>

          {/* End Pulse */}
          <button
            onClick={() => handleSetStatus("ended")}
            disabled={isSettingStatus || settings.pulse_status === "ended"}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-300 font-bold text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group"
          >
            <Square className="w-6 h-6 group-hover:scale-110 transition-transform" />
            End Pulse
          </button>

          {/* Reset to Upcoming */}
          <button
            onClick={() => handleSetStatus("upcoming")}
            disabled={isSettingStatus || settings.pulse_status === "upcoming"}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/40 text-blue-300 font-bold text-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group"
          >
            <Clock className="w-6 h-6 group-hover:scale-110 transition-transform" />
            Set Upcoming
          </button>
        </div>

        {isSettingStatus && (
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <RefreshCw className="w-3 h-3 animate-spin" /> Updating status…
          </div>
        )}
      </div>

      {/* ── SECTION 2: Results Toggle ── */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-700/50 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-purple-500/20 border border-purple-500/30">
            {settings.results_published ? <Eye className="w-4 h-4 text-purple-400" /> : <EyeOff className="w-4 h-4 text-purple-400" />}
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Publish / Hide Results</h3>
            <p className="text-xs text-slate-400">
              When published, students see the final leaderboard. When hidden, they see "Results will be announced."
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`flex-1 p-4 rounded-2xl border text-sm font-semibold ${settings.results_published ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {settings.results_published ? "✅ Results are currently PUBLISHED and visible to all students." : "🙈 Results are HIDDEN. Students see 'Results will be announced.'"}
          </div>
          <button
            onClick={handleToggleResults}
            disabled={isTogglingResults}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-50 ${settings.results_published ? "bg-slate-800 hover:bg-red-900/40 border border-slate-700 hover:border-red-500/50 text-slate-300 hover:text-red-300" : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/25"}`}
          >
            {isTogglingResults
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : settings.results_published
                ? <><EyeOff className="w-3.5 h-3.5" /> Hide Results</>
                : <><Eye className="w-3.5 h-3.5" /> Publish Results</>
            }
          </button>
        </div>
      </div>

      {/* ── SECTION 3: Leaderboard Reset ── */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-700/50 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-rose-500/20 border border-rose-500/30">
            <RotateCcw className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Reset Leaderboard</h3>
            <p className="text-xs text-slate-400">
              Marks the leaderboard as reset. Students will see an empty leaderboard until new submissions come in.
            </p>
          </div>
        </div>

        {settings.leaderboard_reset_at && (
          <div className="text-xs text-slate-400 font-mono">
            Last reset: {new Date(settings.leaderboard_reset_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
          </div>
        )}

        {!showResetConfirm ? (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-xs uppercase tracking-wider transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Leaderboard
          </button>
        ) : (
          <div className="p-4 rounded-2xl bg-rose-900/20 border border-rose-500/40 space-y-3">
            <p className="text-xs text-rose-300 font-semibold">⚠️ This will clear the leaderboard display for all students. Actual database records are NOT deleted — only the reset marker is updated. Confirm?</p>
            <div className="flex gap-3">
              <button
                onClick={handleResetLeaderboard}
                disabled={isResettingLeaderboard}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-black text-xs transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
              >
                {isResettingLeaderboard ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                Yes, Reset
              </button>
              <button onClick={() => setShowResetConfirm(false)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs transition cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 4: Start Date Picker ── */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-amber-500/20 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/30">
            <Calendar className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Season Start Date & Time</h3>
            <p className="text-xs text-slate-400">When countdown hits zero and daily pulses begin.</p>
          </div>
        </div>

        <form onSubmit={handleSaveStart} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Date & Time (IST — Asia/Kolkata, UTC+5:30)
            </label>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="w-full rounded-xl bg-slate-950/80 border border-slate-700 text-white text-sm px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition"
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={isSavingStart || !startLocal}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/25 cursor-pointer">
              {isSavingStart ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSavingStart ? "Saving…" : "Save Start Date"}
            </button>
            <button type="button" onClick={handleClearStart} disabled={isClearingStart || !settings.competition_date}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-red-900/50 border border-slate-700 hover:border-red-500/50 disabled:opacity-40 text-slate-300 hover:text-red-300 text-xs font-bold transition cursor-pointer">
              {isClearingStart ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* ── SECTION 5: End Date Picker ── */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-indigo-500/20 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30">
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Season End Date & Time</h3>
            <p className="text-xs text-slate-400">When the season closes and the countdown switches to "Season Ends In".</p>
          </div>
        </div>

        <form onSubmit={handleSaveEnd} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Date & Time (IST — Asia/Kolkata, UTC+5:30)
            </label>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              className="w-full rounded-xl bg-slate-950/80 border border-slate-700 text-white text-sm px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={isSavingEnd || !endLocal}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider transition shadow-lg shadow-indigo-500/25 cursor-pointer">
              {isSavingEnd ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSavingEnd ? "Saving…" : "Save End Date"}
            </button>
            <button type="button" onClick={handleClearEnd} disabled={isClearingEnd || !settings.competition_end_date}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-red-900/50 border border-slate-700 hover:border-red-500/50 disabled:opacity-40 text-slate-300 hover:text-red-300 text-xs font-bold transition cursor-pointer">
              {isClearingEnd ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-200 leading-relaxed">
          <strong className="text-amber-300">All changes are live immediately.</strong>{" "}
          There is no staging environment — every save propagates to students in real time via Supabase Realtime.
          Use the Pause Pulse button if you need a safe window to make changes during a live event.
        </p>
      </div>
    </div>
  );
}
