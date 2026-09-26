/**
 * useCompetitionDate — React hook for the fully dynamic competition system.
 *
 * Fetches all championship_settings from Supabase (competition dates, pulse
 * status, results_published) and subscribes to real-time changes.
 * Every component should use this hook instead of any hardcoded constant.
 */

import { useEffect, useRef, useState } from "react";
import {
  fetchCompetitionSettings,
  subscribeToCompetitionSettings,
  parseDateSetting,
  formatCompetitionDate,
  formatCompetitionDateTime,
  formatCompetitionTime,
  computeSeasonStatus,
  getCachedSetting,
  type CompetitionSettings,
  type PulseStatus,
} from "@/lib/competition-settings-service";

export interface CompetitionDateState {
  // ── Dates ──────────────────────────────────────────────────────────────────
  seasonStartUTC: Date | null;
  seasonEndUTC: Date | null;
  /** e.g. "27 September 2026" */
  seasonStartDisplay: string | null;
  /** e.g. "17 October 2026" */
  seasonEndDisplay: string | null;
  /** e.g. "07:00 PM IST" */
  seasonStartTimeDisplay: string | null;
  /** e.g. "07:00 PM IST" */
  seasonEndTimeDisplay: string | null;
  /** e.g. "27 September 2026, 07:00 PM" */
  seasonStartDisplayFull: string | null;
  seasonEndDisplayFull: string | null;

  // ── Computed status ────────────────────────────────────────────────────────
  /** Auto-computed from dates: "pre" | "live" | "ended" */
  autoSeasonStatus: "pre" | "live" | "ended";
  /** Admin-controlled override: "upcoming" | "live" | "paused" | "ended" */
  adminPulseStatus: PulseStatus;
  /** Whether the competition is effectively live (auto OR admin override) */
  isLive: boolean;
  /** Whether the admin has published final results */
  resultsPublished: boolean;
  /** UTC ISO of last leaderboard reset (or null) */
  leaderboardResetAt: string | null;

  // ── Raw settings ───────────────────────────────────────────────────────────
  rawSettings: CompetitionSettings | null;
  isLoading: boolean;
}

const LOADING_STATE: CompetitionDateState = {
  seasonStartUTC: null,
  seasonEndUTC: null,
  seasonStartDisplay: null,
  seasonEndDisplay: null,
  seasonStartTimeDisplay: null,
  seasonEndTimeDisplay: null,
  seasonStartDisplayFull: null,
  seasonEndDisplayFull: null,
  autoSeasonStatus: "pre",
  adminPulseStatus: "upcoming",
  isLive: false,
  resultsPublished: false,
  leaderboardResetAt: null,
  rawSettings: null,
  isLoading: true,
};

function buildState(
  settings: CompetitionSettings,
  now: Date = new Date()
): CompetitionDateState {
  const startUTC = parseDateSetting(settings.competition_date);
  const endUTC = parseDateSetting(settings.competition_end_date);
  const autoStatus = computeSeasonStatus(now, startUTC, endUTC);
  const adminStatus = settings.pulse_status;

  // isLive = either auto computed as live OR admin explicitly set it to "live"
  const isLive = autoStatus === "live" || adminStatus === "live";

  return {
    seasonStartUTC: startUTC,
    seasonEndUTC: endUTC,
    seasonStartDisplay: formatCompetitionDate(settings.competition_date),
    seasonEndDisplay: formatCompetitionDate(settings.competition_end_date),
    seasonStartTimeDisplay: formatCompetitionTime(settings.competition_date),
    seasonEndTimeDisplay: formatCompetitionTime(settings.competition_end_date),
    seasonStartDisplayFull: formatCompetitionDateTime(settings.competition_date),
    seasonEndDisplayFull: formatCompetitionDateTime(settings.competition_end_date),
    autoSeasonStatus: autoStatus,
    adminPulseStatus: adminStatus,
    isLive,
    resultsPublished: settings.results_published,
    leaderboardResetAt: settings.leaderboard_reset_at,
    rawSettings: settings,
    isLoading: false,
  };
}

function getInitialState(): CompetitionDateState {
  const cachedStart = getCachedSetting("competition_date");
  const cachedEnd = getCachedSetting("competition_end_date");
  const cachedPulseStatus = (getCachedSetting("pulse_status") as PulseStatus) ?? "upcoming";
  const cachedResults = getCachedSetting("results_published") === "true";
  const cachedReset = getCachedSetting("leaderboard_reset_at");

  if (!cachedStart && !cachedEnd) return LOADING_STATE;

  const initialSettings: CompetitionSettings = {
    competition_date: cachedStart,
    competition_end_date: cachedEnd,
    pulse_status: cachedPulseStatus,
    results_published: cachedResults,
    leaderboard_reset_at: cachedReset,
  };
  return buildState(initialSettings, new Date());
}

export function useCompetitionDate(): CompetitionDateState {
  const [state, setState] = useState<CompetitionDateState>(getInitialState);
  const settingsRef = useRef<CompetitionSettings | null>(null);

  // Rebuild state every second so autoSeasonStatus stays accurate
  useEffect(() => {
    const tick = () => {
      if (settingsRef.current) {
        setState(buildState(settingsRef.current, new Date()));
      }
    };

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch
    fetchCompetitionSettings().then((settings) => {
      if (!cancelled) {
        settingsRef.current = settings;
        setState(buildState(settings, new Date()));
      }
    });

    // Real-time subscription
    const unsub = subscribeToCompetitionSettings((settings) => {
      if (!cancelled) {
        settingsRef.current = settings;
        setState(buildState(settings, new Date()));
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return state;
}
