/**
 * useCompetitionDate — React hook for dynamic competition date.
 *
 * Fetches the competition_date and competition_end_date from Supabase
 * and subscribes to real-time changes. The entire site should use this
 * hook (or the context below) instead of hardcoded SEASON_START_UTC /
 * SEASON_END_UTC constants.
 */

import { useEffect, useState } from "react";
import {
  fetchCompetitionSettings,
  subscribeToCompetitionSettings,
  parseDateSetting,
  formatCompetitionDate,
  type CompetitionSettings,
} from "@/lib/competition-settings-service";

export interface CompetitionDateState {
  /** Parsed UTC Date object for season start, or null if not set */
  seasonStartUTC: Date | null;
  /** Parsed UTC Date object for season end, or null if not set */
  seasonEndUTC: Date | null;
  /** Friendly IST string for season start (e.g. "27 September 2026") */
  seasonStartDisplay: string | null;
  /** Friendly IST string for season end */
  seasonEndDisplay: string | null;
  /** Raw settings from Supabase */
  rawSettings: CompetitionSettings | null;
  /** True while the first fetch is in progress */
  isLoading: boolean;
}

const UNSET: CompetitionDateState = {
  seasonStartUTC: null,
  seasonEndUTC: null,
  seasonStartDisplay: null,
  seasonEndDisplay: null,
  rawSettings: null,
  isLoading: true,
};

function buildState(settings: CompetitionSettings): CompetitionDateState {
  return {
    seasonStartUTC: parseDateSetting(settings.competition_date),
    seasonEndUTC: parseDateSetting(settings.competition_end_date),
    seasonStartDisplay: formatCompetitionDate(settings.competition_date),
    seasonEndDisplay: formatCompetitionDate(settings.competition_end_date),
    rawSettings: settings,
    isLoading: false,
  };
}

export function useCompetitionDate(): CompetitionDateState {
  const [state, setState] = useState<CompetitionDateState>(UNSET);

  useEffect(() => {
    let cancelled = false;

    // Initial fetch
    fetchCompetitionSettings().then((settings) => {
      if (!cancelled) setState(buildState(settings));
    });

    // Real-time subscription
    const unsub = subscribeToCompetitionSettings((settings) => {
      if (!cancelled) setState(buildState(settings));
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return state;
}
