// ==============================================================================
// MEDTRAIL CHAMPIONSHIP - SUPABASE EDGE FUNCTION: send-fcm-push
// Firebase Cloud Messaging (FCM) HTTP v1 API with Service Account Authentication
// ==============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushRequestBody {
  notification_id?: string | null;
  title: string;
  body: string;
  icon?: string;
  type?: "pulse" | "badge" | "event" | "general";
  deepLink?: string;
  audience_type?: "all" | "championship" | "college" | "batch" | "individual";
  audience_target?: string | null;
  scheduled_for?: string | null;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// In-memory cache for Google OAuth2 Bearer token
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function pemToBinary(pem: string): Uint8Array {
  const cleanPem = pem
    .replace(/-----BEGIN[ A-Z0-9_-]+-----/g, "")
    .replace(/-----END[ A-Z0-9_-]+-----/g, "")
    .replace(/\s+/g, "");
  const binaryString = atob(cleanPem);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(data: Uint8Array | string): string {
  let base64: string;
  if (typeof data === "string") {
    base64 = btoa(data);
  } else {
    let binary = "";
    for (let i = 0; i < data.byteLength; i++) {
      binary += String.fromCharCode(data[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claim = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaim = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  const binaryKey = pemToBinary(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signatureBuffer));
  const jwt = `${signatureInput}.${encodedSignature}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Google OAuth2 token exchange failed: ${tokenResponse.status} ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  const token = tokenData.access_token;
  const expiresIn = Number(tokenData.expires_in) || 3600;

  cachedAccessToken = {
    token,
    expiresAt: now + expiresIn,
  };

  return token;
}

function getServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "";
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          project_id: parsed.project_id,
          client_email: parsed.client_email,
          private_key: parsed.private_key,
        };
      }
    } catch (err) {
      console.error("[FCM Edge] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON secret:", err);
    }
  }

  // Fallback to individual variables if configured
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKey = Deno.env.get("FIREBASE_PRIVATE_KEY");

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const serviceAccount = getServiceAccount();

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

    // Deliver via Firebase Cloud Messaging HTTP v1 API
    if (!serviceAccount) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Firebase credentials missing: FIREBASE_SERVICE_ACCOUNT is not configured in Supabase secrets",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (targetDevices.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No active device tokens found in database to notify",
          stats: { totalDevices: 0, deliveredCount: 0, failedCount: 0 },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getGoogleAccessToken(serviceAccount);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    for (const device of targetDevices) {
      try {
        const messagePayload = {
          message: {
            token: device.token,
            notification: {
              title,
              body: messageText,
            },
            data: {
              title: String(title),
              body: String(messageText),
              url: String(resolvedDeepLink),
              click_action: String(resolvedDeepLink),
              type: String(type),
              deepLink: String(resolvedDeepLink),
              platform: String(device.platform || "web"),
            },
            webpush: {
              notification: {
                icon,
                badge: icon,
              },
              fcm_options: {
                link: resolvedDeepLink,
              },
            },
          },
        };

        const fcmResponse = await fetch(fcmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(messagePayload),
        });

        if (fcmResponse.ok) {
          deliveredCount++;
        } else {
          failedCount++;
          const errJson = await fcmResponse.json().catch(() => null);
          const errorCode = errJson?.error?.details?.[0]?.errorCode || errJson?.error?.status;
          const errorMessage = errJson?.error?.message || "";

          if (
            errorCode === "UNREGISTERED" ||
            errorCode === "NOT_FOUND" ||
            fcmResponse.status === 404 ||
            errorMessage.includes("UNREGISTERED") ||
            errorMessage.includes("registration token")
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

    // ── Log into championship_notifications table if not already persisted by caller ──
    if (!body.notification_id) {
      try {
        const { error: insertError } = await supabase.from("championship_notifications").insert({
          title,
          body: messageText,
          type,
          target_audience: audience_type,
          sent_by: "Admin Control Center",
        });
        if (insertError) {
          console.error("[FCM Edge] Database insert error into championship_notifications:", insertError);
        }
      } catch (insertEx) {
        console.error("[FCM Edge] Insert exception:", insertEx);
      }
    }

    if (deliveredCount === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Push notification delivery failed: 0 of ${targetDevices.length} registered devices accepted by FCM (${failedCount} failed)`,
          stats: {
            totalDevices: targetDevices.length,
            deliveredCount: 0,
            failedCount,
            platformBreakdown,
            deepLink: resolvedDeepLink,
          },
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Push notification delivered to ${deliveredCount} of ${targetDevices.length} devices successfully!`,
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
