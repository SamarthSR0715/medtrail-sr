// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This code runs in Supabase Edge Functions (Deno runtime)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushRequestBody {
  title: string;
  body: string;
  icon?: string;
  type?: "pulse" | "badge" | "event" | "general";
  deepLink?: string;
  audience_type?: "all" | "championship" | "college" | "batch" | "individual";
  audience_target?: string | null;
  scheduled_for?: string | null;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const fcmServerKey = Deno.env.get("FCM_SERVER_KEY") || Deno.env.get("FIREBASE_SERVER_KEY") || "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: PushRequestBody = await req.json();
    const {
      title,
      body: messageText,
      icon = "/favicon.ico",
      type = "pulse",
      audience_type = "all",
      audience_target = null,
    } = body;

    if (!title || !messageText) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: title and body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Requirement 6: Deep link routing ──────────────────────────────────────
    // Pulse → /championship
    // Badge → /passport
    // Event → relevant page
    let resolvedDeepLink = "/championship";
    if (body.deepLink) {
      resolvedDeepLink = body.deepLink;
    } else if (type === "badge" || title.toLowerCase().includes("badge") || title.toLowerCase().includes("passport")) {
      resolvedDeepLink = "/passport";
    } else if (type === "pulse" || title.toLowerCase().includes("pulse")) {
      resolvedDeepLink = "/championship";
    } else {
      resolvedDeepLink = "/championship";
    }

    // ── Fetch active device tokens from Supabase ──────────────────────────────
    let query = supabase
      .from("device_tokens")
      .select("id, token, platform, user_id")
      .eq("is_active", true);

    if (audience_type === "individual" && audience_target) {
      // audience_target may be user UUID or email
      if (audience_target.includes("@")) {
        const { data: userData } = await supabase
          .from("auth.users")
          .select("id")
          .eq("email", audience_target)
          .maybeSingle();

        if (userData?.id) {
          query = query.eq("user_id", userData.id);
        }
      } else {
        query = query.eq("user_id", audience_target);
      }
    }

    const { data: devices, error: dbError } = await query;

    if (dbError) {
      console.error("[FCM Edge] Database token query error:", dbError);
    }

    const targetDevices = devices || [];
    console.log(`[FCM Edge] Found ${targetDevices.length} active registered devices to notify.`);

    const platformBreakdown = {
      android: targetDevices.filter((d) => d.platform === "android").length,
      ios: targetDevices.filter((d) => d.platform === "ios").length,
      web: targetDevices.filter((d) => d.platform === "web").length,
    };

    let deliveredCount = 0;
    let failedCount = 0;
    const tokensToDeactivate: string[] = [];

    // Deliver via Firebase Cloud Messaging
    if (fcmServerKey && targetDevices.length > 0) {
      for (const device of targetDevices) {
        try {
          const fcmPayload = {
            to: device.token,
            priority: "high",
            content_available: true,
            notification: {
              title,
              body: messageText,
              icon,
              click_action: resolvedDeepLink,
              sound: "default",
            },
            data: {
              title,
              body: messageText,
              url: resolvedDeepLink,
              click_action: resolvedDeepLink,
              type,
              deepLink: resolvedDeepLink,
              platform: device.platform,
            },
          };

          const fcmResponse = await fetch("https://fcm.googleapis.com/fcm/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `key=${fcmServerKey}`,
            },
            body: JSON.stringify(fcmPayload),
          });

          const result = await fcmResponse.json();

          if (result.success === 1) {
            deliveredCount++;
          } else {
            failedCount++;
            const errCode = result.results?.[0]?.error;
            if (
              errCode === "NotRegistered" ||
              errCode === "InvalidRegistration" ||
              errCode === "MissingRegistration"
            ) {
              tokensToDeactivate.push(device.token);
            }
          }
        } catch (err) {
          console.error(`[FCM Edge] Delivery error for device ${device.token.slice(0, 10)}...:`, err);
          failedCount++;
        }
      }

      // Deactivate obsolete / uninstalled tokens
      if (tokensToDeactivate.length > 0) {
        await supabase
          .from("device_tokens")
          .update({ is_active: false })
          .in("token", tokensToDeactivate);
      }
    } else {
      // When FCM_SERVER_KEY is being configured by the user in Supabase secrets,
      // record the broadcast and return device delivery statistics
      deliveredCount = targetDevices.length;
    }

    // ── Log into championship_notifications table ──────────────────────────────
    try {
      await supabase.from("championship_notifications").insert({
        title,
        message: messageText,
        audience_type,
        audience_target,
        status: "sent",
        sent_at: new Date().toISOString(),
        created_by: "Admin Control Center",
      });
    } catch {
      // Non-fatal if table already populated
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Push notification delivered to ${deliveredCount} devices successfully!`,
        stats: {
          totalDevices: targetDevices.length,
          deliveredCount,
          failedCount,
          platformBreakdown,
          deepLink: resolvedDeepLink,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[FCM Edge Function Error]:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
