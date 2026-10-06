/**
 * ==============================================================================
 * Module: anti-cheat-service.ts
 * Description:
 *   Production-grade, mobile-first browser anti-cheat telemetry service.
 *   Captures privacy-respecting client integrity events (tab visibility,
 *   blur/focus, fullscreen transitions, clipboard protection, heartbeat)
 *   and flushes them in batches to the database via log_anti_cheat_events_batch.
 *
 * Security Principles:
 *   - NEVER performs direct INSERT into database tables.
 *   - Uses batching & beacon flush to prevent battery drain or network lag.
 *   - Completely non-blocking: Telemetry failure never blocks quiz completion.
 *   - Purely passive and fair: Risk score informs admin review only.
 * ==============================================================================
 */

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CanonicalAntiCheatEventType =
  | "TAB_HIDDEN"
  | "TAB_VISIBLE"
  | "WINDOW_BLUR"
  | "WINDOW_FOCUS"
  | "FULLSCREEN_ENTER"
  | "FULLSCREEN_EXIT"
  | "COPY_ATTEMPT"
  | "PASTE_ATTEMPT"
  | "PAGE_HIDDEN"
  | "PAGE_VISIBLE"
  | "HEARTBEAT"
  | "DEVTOOLS_OPENED"
  | "DEBUGGER_HALTED"
  | "EXTENSION_TAMPERING"
  | "SCRIPT_INJECTION"
  | "TAB_SWITCH"
  | "RAPID_ANSWER"
  | "RATE_LIMIT_EXCEEDED"
  | "HEARTBEAT_JITTER";

export interface AntiCheatTelemetryEvent {
  event_type: CanonicalAntiCheatEventType;
  client_timestamp: string;
  duration_ms?: number | null;
  metadata?: Record<string, any>;
}

export interface AntiCheatTelemetryOptions {
  sessionId: string | null | undefined;
  active: boolean;
  onWarning?: (warning: string) => void;
}

/**
 * Flush telemetry events to the database via secure RPC.
 * Never executes direct INSERT into championship_anti_cheat_events.
 */
export async function logAntiCheatEventsBatch(
  sessionId: string,
  events: AntiCheatTelemetryEvent[]
): Promise<{ success: boolean; loggedCount?: number; errorCode?: string }> {
  if (!sessionId || !events || events.length === 0) {
    return { success: true, loggedCount: 0 };
  }

  try {
    const { data, error } = await (supabase as any).rpc("log_anti_cheat_events_batch", {
      p_session_id: sessionId,
      p_events: events,
    });

    if (error) {
      // Non-fatal warning: never disrupt the student's exam experience
      console.warn("[AntiCheatTelemetry] Batch log notice:", error.message);
      return { success: false, errorCode: error.code };
    }

    return {
      success: data?.success ?? true,
      loggedCount: data?.logged_count ?? events.length,
      errorCode: data?.error_code,
    };
  } catch (err) {
    console.warn("[AntiCheatTelemetry] Exception during batch flush:", err);
    return { success: false, errorCode: "CLIENT_NETWORK_ERROR" };
  }
}

/**
 * React hook that manages passive integrity telemetry during an active Pulse exam.
 * Automatically active ONLY when an authorized exam session exists.
 */
export function useAntiCheatTelemetry({
  sessionId,
  active,
  onWarning,
}: AntiCheatTelemetryOptions) {
  const eventQueueRef = useRef<AntiCheatTelemetryEvent[]>([]);
  const isFlushingRef = useRef(false);
  const blurStartTimeRef = useRef<number | null>(null);
  const hiddenStartTimeRef = useRef<number | null>(null);
  const heartbeatSeqRef = useRef<number>(0);
  const lastHeartbeatTimeRef = useRef<number>(Date.now());
  const sessionIdRef = useRef<string | null>(sessionId || null);

  sessionIdRef.current = sessionId || null;

  // Flush queued events to the server
  const flushQueue = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId || eventQueueRef.current.length === 0 || isFlushingRef.current) {
      return;
    }

    const eventsToFlush = [...eventQueueRef.current];
    eventQueueRef.current = [];
    isFlushingRef.current = true;

    try {
      await logAntiCheatEventsBatch(currentSessionId, eventsToFlush);
    } catch {
      // Re-queue un-flushed events up to a safety limit
      eventQueueRef.current = [...eventsToFlush.slice(-20), ...eventQueueRef.current];
    } finally {
      isFlushingRef.current = false;
    }
  }, []);

  // Enqueue a single telemetry event
  const enqueueEvent = useCallback(
    (
      eventType: CanonicalAntiCheatEventType,
      durationMs: number | null = null,
      metadata: Record<string, any> = {}
    ) => {
      const event: AntiCheatTelemetryEvent = {
        event_type: eventType,
        client_timestamp: new Date().toISOString(),
        duration_ms: durationMs,
        metadata: {
          ...metadata,
          url: typeof window !== "undefined" ? window.location.pathname : "",
        },
      };

      eventQueueRef.current.push(event);

      // Trigger immediate flush if queue grows large
      if (eventQueueRef.current.length >= 8) {
        flushQueue();
      }
    },
    [flushQueue]
  );

  useEffect(() => {
    if (!active || !sessionId) {
      // Inactive: ensure any lingering events are flushed cleanly
      if (sessionIdRef.current && eventQueueRef.current.length > 0) {
        flushQueue();
      }
      return;
    }

    // ── 1. Tab Visibility Listener ────────────────────────────────────────────
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenStartTimeRef.current = Date.now();
        enqueueEvent("TAB_HIDDEN", null, { reason: "tab_switched_or_minimized" });
        if (onWarning) onWarning("Exam window hidden. Please remain on this tab.");
      } else if (document.visibilityState === "visible") {
        const awayDuration = hiddenStartTimeRef.current
          ? Date.now() - hiddenStartTimeRef.current
          : null;
        hiddenStartTimeRef.current = null;
        enqueueEvent("TAB_VISIBLE", awayDuration, { return_time: new Date().toISOString() });
      }
    };

    // ── 2. Window Focus / Blur Listeners ──────────────────────────────────────
    const handleWindowBlur = () => {
      blurStartTimeRef.current = Date.now();
      enqueueEvent("WINDOW_BLUR", null, { reason: "window_focus_lost" });
    };

    const handleWindowFocus = () => {
      const blurDuration = blurStartTimeRef.current
        ? Date.now() - blurStartTimeRef.current
        : null;
      blurStartTimeRef.current = null;
      enqueueEvent("WINDOW_FOCUS", blurDuration, { return_time: new Date().toISOString() });
    };

    // ── 3. Fullscreen Transitions ─────────────────────────────────────────────
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        enqueueEvent("FULLSCREEN_EXIT", null, { reason: "fullscreen_dismissed" });
      } else {
        enqueueEvent("FULLSCREEN_ENTER", null, { reason: "fullscreen_engaged" });
      }
    };

    // ── 4. Clipboard Protections ──────────────────────────────────────────────
    const handleCopy = (e: ClipboardEvent) => {
      enqueueEvent("COPY_ATTEMPT", null, { reason: "user_attempted_copy" });
    };

    const handlePaste = (e: ClipboardEvent) => {
      enqueueEvent("PASTE_ATTEMPT", null, { reason: "user_attempted_paste" });
    };

    // ── 5. Page Lifecycle ─────────────────────────────────────────────────────
    const handlePageHide = () => {
      enqueueEvent("PAGE_HIDDEN", null, { reason: "page_backgrounded" });
      // Synchronous attempt or beacon flush on pagehide
      flushQueue();
    };

    const handlePageShow = () => {
      enqueueEvent("PAGE_VISIBLE", null, { reason: "page_resumed" });
    };

    // ── 6. Periodic Heartbeat & DevTools Probe ─────────────────────────────────
    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastHeartbeatTimeRef.current;
      lastHeartbeatTimeRef.current = now;
      heartbeatSeqRef.current += 1;

      // Jitter detection (> 14s between expected 10s intervals)
      if (delta > 14000) {
        enqueueEvent("HEARTBEAT_JITTER", delta, { expected_ms: 10000, actual_ms: delta });
      }

      enqueueEvent("HEARTBEAT", null, { seq: heartbeatSeqRef.current });

      // DevTools heuristic check (window size divergence)
      if (
        window.outerWidth - window.innerWidth > 160 ||
        window.outerHeight - window.innerHeight > 160
      ) {
        enqueueEvent("DEVTOOLS_OPENED", null, {
          innerWidth: window.innerWidth,
          outerWidth: window.outerWidth,
          innerHeight: window.innerHeight,
          outerHeight: window.outerHeight,
        });
      }

      // Flush queue regularly
      flushQueue();
    }, 10000);

    // Register active DOM listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    // Initial heartbeat
    enqueueEvent("HEARTBEAT", null, { seq: 0, initial: true });

    return () => {
      clearInterval(heartbeatInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);

      // Final flush on unmount
      flushQueue();
    };
  }, [active, sessionId, enqueueEvent, flushQueue, onWarning]);

  return {
    enqueueEvent,
    flushQueue,
  };
}
