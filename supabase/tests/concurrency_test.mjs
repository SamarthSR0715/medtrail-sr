/**
 * Concurrency Verification Test: submit_pulse_attempt_atomic
 *
 * Simulates genuine concurrent duplicate submissions across two independent
 * network requests/database connections hitting the database simultaneously
 * as an authenticated student.
 *
 * Verifies that:
 *  1. PostgreSQL's unique constraint (user_id, pulse_id) and the RPC's
 *     EXCEPTION WHEN unique_violation block prevent race-condition duplicates.
 *  2. Exactly one submission succeeds ({ success: true, attempt_id }).
 *  3. Exactly one submission returns { already_submitted: true } without crashing.
 *  4. No 500 error or unhandled database exception occurs.
 *
 * Usage:
 *   node supabase/tests/concurrency_test.mjs <STAGING_SUPABASE_URL> <STAGING_SERVICE_ROLE_KEY>
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.argv[2] || process.env.STAGING_SUPABASE_URL;
const serviceRoleKey = process.argv[3] || process.env.STAGING_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Usage: node supabase/tests/concurrency_test.mjs <STAGING_SUPABASE_URL> <STAGING_SERVICE_ROLE_KEY>");
  process.exit(1);
}

// 1. Privileged admin client using service_role key (strictly for setup and teardown)
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function runConcurrencyTest() {
  console.log("=====================================================");
  console.log("STARTING CONCURRENCY RACE-CONDITION TEST");
  console.log("Target Project URL:", supabaseUrl);
  console.log("=====================================================");

  const testUserId = "66666666-6666-6666-6666-666666666666";
  const testEmail = "concurrent_student@medtrail.test";
  const testPassword = "TestPassword_123456!";
  const testPulseId = "88888888-8888-8888-8888-888888888888";
  const testPulseDate = "2026-10-02";

  try {
    // Clean up any stale leftover from previous aborted runs
    console.log("[Setup] Pre-cleaning test fixtures...");
    try {
      await adminClient.auth.admin.deleteUser(testUserId);
    } catch {
      // Ignore if user does not exist
    }
    await adminClient.from("championship_pulse_attempts").delete().eq("pulse_id", testPulseId);
    await adminClient.from("championship_leaderboard").delete().eq("pulse_id", testPulseId);
    await adminClient.from("championship_registrations").delete().eq("user_id", testUserId);

    // 1. Create authenticated student account using Supabase Auth Admin API
    console.log("[Setup] Creating test student in Supabase Auth...");
    const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
      id: testUserId,
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: "Dr. Concurrency Tester" },
    });

    if (userErr) {
      throw new Error(`Failed to create test auth user: ${userErr.message}`);
    }

    // 2. Ensure published pulse set fixture exists
    console.log("[Setup] Ensuring published pulse set exists...");
    const { error: pulseErr } = await adminClient.from("championship_pulse_sets").upsert({
      id: testPulseId,
      pulse_date: testPulseDate,
      status: "published",
      questions: [],
    });

    if (pulseErr) {
      throw new Error(`Failed to upsert pulse set: ${pulseErr.message}`);
    }

    // 3. Ensure approved championship registration exists
    console.log("[Setup] Creating approved championship registration...");
    const { error: regErr } = await adminClient.from("championship_registrations").upsert({
      user_id: testUserId,
      full_name: "Dr. Concurrency Tester",
      email: testEmail,
      medical_college: "AIIMS New Delhi",
      batch: "2026 Batch → Freshers",
      approval_status: "approved",
    });

    if (regErr) {
      throw new Error(`Failed to create registration: ${regErr.message}`);
    }

    // 4. Authenticate as the student to obtain genuine JWT access token
    console.log("[Setup] Authenticating student session to acquire valid JWT...");
    const { data: authData, error: loginErr } = await adminClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (loginErr || !authData.session?.access_token) {
      throw new Error(`Failed to log in as test student: ${loginErr?.message}`);
    }

    const studentAccessToken = authData.session.access_token;

    // 5. Instantiate TWO separate client connections initialized with the student's JWT
    const clientA = createClient(supabaseUrl, studentAccessToken, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${studentAccessToken}` } },
    });

    const clientB = createClient(supabaseUrl, studentAccessToken, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${studentAccessToken}` } },
    });

    // 6. Launch simultaneous submissions
    console.log("[Execution] Firing 2 simultaneous submit_pulse_attempt_atomic RPC calls...");

    const payload = {
      p_pulse_id: testPulseId,
      p_pulse_date: testPulseDate,
      p_user_id: testUserId,
      p_user_email: testEmail,
      p_student_name: "Dr. Concurrency Tester",
      p_college: "AIIMS New Delhi",
      p_batch: "2026 Batch → Freshers",
      p_score: 100,
      p_accuracy: 100,
      p_time_taken_seconds: 25,
      p_xp: 150,
      p_answers: [],
    };

    const [resA, resB] = await Promise.all([
      clientA.rpc("submit_pulse_attempt_atomic", payload),
      clientB.rpc("submit_pulse_attempt_atomic", payload),
    ]);

    console.log("[Result Connection A]:", JSON.stringify(resA.data), resA.error ? `Error: ${resA.error.message}` : "");
    console.log("[Result Connection B]:", JSON.stringify(resB.data), resB.error ? `Error: ${resB.error.message}` : "");

    if (resA.error || resB.error) {
      throw new Error(`Unexpected network/database RPC error: ${resA.error?.message || resB.error?.message}`);
    }

    const successes = [resA.data, resB.data].filter((r) => r?.success === true);
    const alreadySubmitted = [resA.data, resB.data].filter((r) => r?.already_submitted === true);

    if (successes.length === 1 && alreadySubmitted.length === 1) {
      console.log("=====================================================");
      console.log("✓ CONCURRENCY TEST PASSED: Exactly 1 submission succeeded and 1 race duplicate was safely intercepted!");
      console.log("  Winning Attempt ID:", successes[0].attempt_id);
      console.log("  Handled Duplicate ID:", alreadySubmitted[0].attempt_id);
      console.log("=====================================================");
    } else {
      throw new Error(
        `CONCURRENCY VIOLATION! Expected 1 success and 1 already_submitted, but got ${successes.length} successes and ${alreadySubmitted.length} already_submitted.`
      );
    }

    // 7. Verify Database Integrity (exactly 1 persisted attempt row)
    const { count, error: countErr } = await adminClient
      .from("championship_pulse_attempts")
      .select("*", { count: "exact", head: true })
      .eq("pulse_id", testPulseId)
      .eq("user_id", testUserId);

    if (countErr || count !== 1) {
      throw new Error(`Database integrity violation: Expected exactly 1 row in championship_pulse_attempts, found ${count}`);
    }
    console.log("✓ Database integrity confirmed: exactly 1 attempt row persisted in championship_pulse_attempts.");

    // 8. Teardown & Cleanup
    console.log("[Cleanup] Removing test records and test auth user...");
    await adminClient.from("championship_pulse_attempts").delete().eq("pulse_id", testPulseId).eq("user_id", testUserId);
    await adminClient.from("championship_leaderboard").delete().eq("pulse_id", testPulseId).eq("user_id", testUserId);
    await adminClient.from("championship_registrations").delete().eq("user_id", testUserId);
    await adminClient.auth.admin.deleteUser(testUserId);

    console.log("✓ Concurrency test cleanup completed successfully.");
  } catch (err) {
    console.error("✗ CONCURRENCY TEST FAILED:", err?.message || err);
    // Best-effort cleanup on failure
    try {
      await adminClient.from("championship_pulse_attempts").delete().eq("pulse_id", testPulseId);
      await adminClient.from("championship_registrations").delete().eq("user_id", testUserId);
      await adminClient.auth.admin.deleteUser(testUserId);
    } catch {
      // Ignore cleanup error
    }
    process.exit(1);
  }
}

runConcurrencyTest();
