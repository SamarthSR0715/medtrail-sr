/**
 * useCompetitionDate — React hook for the fully dynamic competition system.
 *
 * Fetches pulse_settings from Supabase (competition date, start/end time, pulse
 * status, results_published) and subscribes to real-time changes.
 * "pulse_settings" is the ONLY source of truth.
 */

import { useEffect, useRef, useState } from "react";
import {
  fetchCompetitionSettings,
  subscribeToCompetitionSettings,
  combineDateAndTime,
  formatCompetitionDate,
  formatCompetitionDateTime,
  formatCompetitionTime,
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
  /** e.g. "7:00 PM IST" */
  seasonStartTimeDisplay: string | null;
  /** e.g. "11:59 PM IST" */
  seasonEndTimeDisplay: string | null;
  /** e.g. "27 September 2026, 07:00 PM" */
  seasonStartDisplayFull: string | null;
  seasonEndDisplayFull: string | null;

  // ── Computed status ────────────────────────────────────────────────────────
  /** Auto-computed from dates: "pre" | "live" | "ended" */
  autoSeasonStatus: "pre" | "live" | "ended";
  /** Pulse status from pulse_settings: "upcoming" | "live" | "paused" | "ended" */
  adminPulseStatus: PulseStatus;
  /** Whether the competition is live strictly according to pulse_settings */
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
  settings: CompetitionSettings
): CompetitionDateState {
  const startUTC = combineDateAndTime(settings.competition_date, settings.start_time);
  const endUTC = combineDateAndTime(settings.competition_end_date || settings.competition_date, settings.end_time);
  const adminStatus: PulseStatus = settings.pulse_status || "upcoming";

  // In Pulse 2.0, pulse_settings is the ONLY source of truth:
  const isLive = adminStatus === "live";

  const startTimeLabel = settings.start_time
    ? formatCompetitionTime(settings.start_time)
    : formatCompetitionTime(settings.competition_date);

  const endTimeLabel = settings.end_time
    ? formatCompetitionTime(settings.end_time)
    : formatCompetitionTime(settings.competition_end_date || settings.competition_date);

  return {
    seasonStartUTC: startUTC,
    seasonEndUTC: endUTC,
    seasonStartDisplay: formatCompetitionDate(settings.competition_date),
    seasonEndDisplay: formatCompetitionDate(settings.competition_end_date || settings.competition_date),
    seasonStartTimeDisplay: startTimeLabel,
    seasonEndTimeDisplay: endTimeLabel,
    seasonStartDisplayFull: formatCompetitionDateTime(settings.competition_date),
    seasonEndDisplayFull: formatCompetitionDateTime(settings.competition_end_date || settings.competition_date),
    autoSeasonStatus: isLive ? "live" : adminStatus === "ended" ? "ended" : "pre",
    adminPulseStatus: adminStatus,
    isLive,
    resultsPublished: Boolean(settings.results_published),
    leaderboardResetAt: settings.leaderboard_reset_at,
    rawSettings: settings,
    isLoading: false,
  };
}

export function useCompetitionDate(): CompetitionDateState {
  const [state, setState] = useState<CompetitionDateState>(LOADING_STATE);
  const settingsRef = useRef<CompetitionSettings | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch from pulse_settings
    fetchCompetitionSettings().then((settings) => {
      if (!cancelled) {
        settingsRef.current = settings;
        setState(buildState(settings));
      }
    });

    // Real-time subscription to pulse_settings
    const unsub = subscribeToCompetitionSettings((settings) => {
      if (!cancelled) {
        settingsRef.current = settings;
        setState(buildState(settings));
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return state;
}
