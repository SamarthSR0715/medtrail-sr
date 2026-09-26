/**
 * CompetitionSettings — Admin Panel Component
 * Allows the super admin to change the competition_date and competition_end_date
 * from a UI datetime picker. Changes are saved to Supabase and propagate
 * to all connected students in real time via the realtime channel.
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
} from "lucide-react";
import {
  fetchCompetitionSettings,
  saveCompetitionSetting,
  utcToISTLocal,
  istLocalToUTC,
  formatCompetitionDate,
  type CompetitionSettings,
} from "@/lib/competition-settings-service";

interface CompetitionSettingsProps {
  adminEmail?: string | undefined;
}

export function CompetitionSettings({ adminEmail }: CompetitionSettingsProps) {
  const [settings, setSettings] = useState<CompetitionSettings>({
    competition_date: null,
    competition_end_date: null,
  });

  // IST local datetime strings for the <input type="datetime-local"> pickers
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingStart, setIsSavingStart] = useState(false);
  const [isSavingEnd, setIsSavingEnd] = useState(false);
  const [isClearingStart, setIsClearingStart] = useState(false);
  const [isClearingEnd, setIsClearingEnd] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

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
  }, []);

  // ── Save start date ──────────────────────────────────────────────────────────
  const handleSaveStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startLocal) {
      toast.error("Please select a date & time for the competition start.");
      return;
    }
    setIsSavingStart(true);
    try {
      const utcISO = istLocalToUTC(startLocal);
      const res = await saveCompetitionSetting("competition_date", utcISO, adminEmail);
      if (res.success) {
        toast.success("✅ Competition start date saved! All student views updated in real time.");
        setLastSaved(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
        await loadSettings();
      } else {
        toast.error(`Failed to save: ${res.error}`);
      }
    } finally {
      setIsSavingStart(false);
    }
  };

  // ── Save end date ────────────────────────────────────────────────────────────
  const handleSaveEnd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endLocal) {
      toast.error("Please select a date & time for the competition end.");
      return;
    }
    setIsSavingEnd(true);
    try {
      const utcISO = istLocalToUTC(endLocal);
      const res = await saveCompetitionSetting("competition_end_date", utcISO, adminEmail);
      if (res.success) {
        toast.success("✅ Competition end date saved! All student views updated in real time.");
        setLastSaved(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
        await loadSettings();
      } else {
        toast.error(`Failed to save: ${res.error}`);
      }
    } finally {
      setIsSavingEnd(false);
    }
  };

  // ── Clear start date (show TBA) ──────────────────────────────────────────────
  const handleClearStart = async () => {
    if (!window.confirm("Clear the competition start date? The site will show 'Competition date will be announced.' to all students.")) return;
    setIsClearingStart(true);
    try {
      const res = await saveCompetitionSetting("competition_date", null, adminEmail);
      if (res.success) {
        toast.info("Competition start date cleared. Site now shows 'TBA'.");
        setStartLocal("");
        await loadSettings();
      } else {
        toast.error(`Failed to clear: ${res.error}`);
      }
    } finally {
      setIsClearingStart(false);
    }
  };

  // ── Clear end date ───────────────────────────────────────────────────────────
  const handleClearEnd = async () => {
    if (!window.confirm("Clear the competition end date?")) return;
    setIsClearingEnd(true);
    try {
      const res = await saveCompetitionSetting("competition_end_date", null, adminEmail);
      if (res.success) {
        toast.info("Competition end date cleared.");
        setEndLocal("");
        await loadSettings();
      } else {
        toast.error(`Failed to clear: ${res.error}`);
      }
    } finally {
      setIsClearingEnd(false);
    }
  };

  const startDisplay = formatCompetitionDate(settings.competition_date);
  const endDisplay = formatCompetitionDate(settings.competition_end_date);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white">Competition Settings</h2>
          <p className="text-xs text-slate-400 mt-1">
            Set the global competition date. All countdowns, hero sections, and registration messages
            update automatically for all students in real time.
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

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/30">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-200 leading-relaxed">
          <strong className="text-blue-300">How it works:</strong> Times are entered in IST (India Standard Time, UTC+5:30)
          and stored in UTC in Supabase. The countdown timer, hero section, and registration text on the championship
          page all read from this setting. If you clear the date, the site shows{" "}
          <em>"Competition date will be announced."</em>
        </div>
      </div>

      {/* Current Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Start Date Status */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-amber-500/30 space-y-2">
          <div className="flex items-center gap-2">
            {settings.competition_date ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-slate-500" />
            )}
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
              Current Start Date
            </span>
          </div>
          {startDisplay ? (
            <div>
              <div className="text-base font-black text-white">{startDisplay}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                UTC: {settings.competition_date}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 italic">Not set — showing "TBA" to students</div>
          )}
        </div>

        {/* End Date Status */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-indigo-500/30 space-y-2">
          <div className="flex items-center gap-2">
            {settings.competition_end_date ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-slate-500" />
            )}
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-400">
              Current End Date
            </span>
          </div>
          {endDisplay ? (
            <div>
              <div className="text-base font-black text-white">{endDisplay}</div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                UTC: {settings.competition_end_date}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500 italic">Not set</div>
          )}
        </div>
      </div>

      {/* Start Date Picker */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-amber-500/20 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/30">
            <Calendar className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Season Start Date & Time</h3>
            <p className="text-xs text-slate-400">
              This is when the countdown reaches zero and daily pulses begin.
            </p>
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
              className="w-full rounded-xl bg-slate-950/80 border border-slate-700 text-white text-sm px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition"
            />
            <p className="text-[11px] text-slate-500">
              Enter the date and time in India Standard Time (IST). This will be converted to UTC automatically.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSavingStart || !startLocal}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/25 cursor-pointer"
            >
              {isSavingStart ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {isSavingStart ? "Saving…" : "Save Start Date"}
            </button>
            <button
              type="button"
              onClick={handleClearStart}
              disabled={isClearingStart || !settings.competition_date}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-red-900/50 border border-slate-700 hover:border-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 hover:text-red-300 text-xs font-bold transition cursor-pointer"
              title="Clear date — shows 'TBA' to students"
            >
              {isClearingStart ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* End Date Picker */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-indigo-500/20 shadow-xl space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
          <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30">
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Season End Date & Time</h3>
            <p className="text-xs text-slate-400">
              When the season closes. The countdown switches to "Season Ends In" once the season is live.
            </p>
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
              className="w-full rounded-xl bg-slate-950/80 border border-slate-700 text-white text-sm px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition"
            />
            <p className="text-[11px] text-slate-500">
              Enter the date and time in India Standard Time (IST).
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSavingEnd || !endLocal}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider transition shadow-lg shadow-indigo-500/25 cursor-pointer"
            >
              {isSavingEnd ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {isSavingEnd ? "Saving…" : "Save End Date"}
            </button>
            <button
              type="button"
              onClick={handleClearEnd}
              disabled={isClearingEnd || !settings.competition_end_date}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-red-900/50 border border-slate-700 hover:border-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 hover:text-red-300 text-xs font-bold transition cursor-pointer"
              title="Clear end date"
            >
              {isClearingEnd ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-200 leading-relaxed">
          <strong className="text-amber-300">Live impact:</strong> Saving a date immediately updates the countdown timer,
          hero section, and all registration text visible to students. There is no staging — changes go live instantly.
          {lastSaved && (
            <span className="ml-2 text-emerald-400 font-semibold">Last saved at {lastSaved} IST.</span>
          )}
        </div>
      </div>
    </div>
  );
}
