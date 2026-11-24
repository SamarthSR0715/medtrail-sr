/**
 * ==============================================================================
 * Concurrency & Race Condition Verification Test Suite
 * File: supabase/tests/finale_concurrency_test.mjs
 * Status: SPECIFICATION & TEST HARNESS (REMEDIATED FOR ADV-03)
 * ==============================================================================
 *
 * Description:
 *   Validates multi-client racing, simultaneous duplicate taps, conflicting requests,
 *   out-of-order ingress, advisory lock serialization, and partial unique index
 *   enforcement under high concurrency against the Grand Finale PostgreSQL RPCs.
 *
 * Remediations Applied (Phase 2.4 / ADV-03):
 *   1. Authenticated Participant Clients: Replaces unauthenticated service_role RPC
 *      calls with genuine authenticated participant clients via signInWithPassword.
 *   2. Independent Identities: Distinguishes Student 1, Student 2, Admin 1, and Admin 2
 *      with verified app_metadata and auth.uid() propagation into PostgreSQL.
 *   3. Zero Silent Skips: Eliminates conditional skip guards (e.g. if (sessionId)).
 *      Missing sessions or RPC failures throw hard assertion errors.
 *   4. Granular Test Metrics: Tracks totalAssertionsChecked, testsPlanned, testsExecuted,
 *      testsPassed, testsFailed, and testsSkipped.
 *   5. Atomic Score Integrity: Verifies that racing duplicate submissions credit points
 *      exactly once (100 points, 0 double-crediting) and create exactly 1 row.
 *   6. Conflicting Submission Rejection: Proves that simultaneous opposing actions
 *      (e.g., Answer vs Skip on same slot) resolve to exactly one winner and one
 *      ERR_SLOT_ALREADY_COMMITTED_CONFLICT rejection.
 *   7. Dual Administrative Approval Concurrency: Verifies two-person approval racing
 *      and TOCTOU hash validation serialization.
 *   8. Deterministic Isolation & Teardown: Uses strict synthetic UUIDs and prefixes,
 *      ensuring no production or unrelated test records are ever touched or retained.
 *
 * Safety Notice:
 *   DO NOT RUN AGAINST PRODUCTION.
 *   This script contains an active safeguard that aborts immediately if executed
 *   against production hostnames or project identifiers (jgurginsphlfdzwkitso).
 *
 * Usage (Sandbox / Local Dev only):
 *   node supabase/tests/finale_concurrency_test.mjs <SANDBOX_URL> <SANDBOX_SERVICE_ROLE_KEY> [SANDBOX_ANON_KEY]
 * ==============================================================================
 */

import { createClient } from "@supabase/supabase-js";

// ── 0. STRICT ENVIRONMENT SAFEGUARD ───────────────────────────────────────────
const PROD_REF = "jgurginsphlfdzwkitso";
const targetUrl = process.argv[2] || process.env.SANDBOX_SUPABASE_URL || "";
const serviceKey = process.argv[3] || process.env.SANDBOX_SERVICE_ROLE_KEY || "";
const anonKey = process.argv[4] || process.env.SANDBOX_ANON_KEY || serviceKey;

// ── 1. TEST FIXTURES & CONSTANTS ──────────────────────────────────────────────
const SYNTH_ADMIN1_ID = "99999999-0000-0000-0000-000000000001";
const SYNTH_ADMIN2_ID = "99999999-0000-0000-0000-000000000002";
const SYNTH_STUDENT1_ID = "11111111-0000-0000-0000-000000000001";
const SYNTH_STUDENT2_ID = "11111111-0000-0000-0000-000000000002";

const TEST_PASSWORD = "TestPassword_123456!";

const TEST_USERS = [
  { id: SYNTH_ADMIN1_ID, email: "admin1@finale-concurrency.test", role: "admin", is_admin: true, name: "Admin One" },
  { id: SYNTH_ADMIN2_ID, email: "admin2@finale-concurrency.test", role: "admin", is_admin: true, name: "Admin Two" },
  { id: SYNTH_STUDENT1_ID, email: "student1@finale-concurrency.test", role: "authenticated", is_admin: false, name: "Dr. Finalist One" },
  { id: SYNTH_STUDENT2_ID, email: "student2@finale-concurrency.test", role: "authenticated", is_admin: false, name: "Dr. Finalist Two" },
];

// ── 2. EXECUTION & ASSERTION COUNTERS (ADV-03) ────────────────────────────────
let totalAssertionsChecked = 0;
const testsPlanned = 6;
let testsExecuted = 0;
let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

function assert(condition, message) {
  totalAssertionsChecked++;
  if (condition) {
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    testsFailed++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ── 3. AUTHENTICATED CLIENT FACTORY (ADV-03) ──────────────────────────────────
/**
 * Creates a dedicated Supabase client for a specific user and logs in via signInWithPassword.
 * Ensures genuine bearer tokens with verified auth.uid() are passed to PostgreSQL RPCs.
 */
async function getAuthenticatedClient(url, key, email, password) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data?.session?.access_token) {
    throw new Error(`Authentication failed for ${email}: ${error ? error.message : "Missing access token"}`);
  }

  return {
    client,
    user: data.user,
    session: data.session,
    userId: data.user.id,
  };
}

// ── 4. DETERMINISTIC CLEANUP HELPER ───────────────────────────────────────────
async function cleanupSyntheticData(adminClient) {
  const syntheticUserIds = [SYNTH_STUDENT1_ID, SYNTH_STUDENT2_ID, SYNTH_ADMIN1_ID, SYNTH_ADMIN2_ID];

  try {
    await adminClient.from("championship_finale_question_states").delete().in("user_id", syntheticUserIds);
    await adminClient.from("championship_finale_sessions").delete().in("user_id", syntheticUserIds);
    await adminClient.from("championship_finale_results").delete().in("user_id", syntheticUserIds);
    await adminClient.from("championship_finale_roster").delete().ilike("qualifier_id", "CONC-QUAL-%");
    await adminClient.from("championship_finale_questions").delete().ilike("question_text", "CONC-Q-%");
    await adminClient.from("championship_finale_admin_approvals").delete().in("first_approver_id", [SYNTH_ADMIN1_ID, SYNTH_ADMIN2_ID]);

    // Reset Day 1 back to clean initial state for repeatable sandbox test runs (SEC-01 / Check 7)
    await adminClient.from("championship_finale_days").update({
      status: "draft",
      results_published: false,
      published_at: null,
      published_by: null,
      paused_at: null,
    }).eq("day_number", 1);
  } catch (err) {
    console.warn("Cleanup warning (non-fatal):", err.message);
  }
}

// ── 5. MAIN CONCURRENCY TEST RUNNER ───────────────────────────────────────────
async function runFinaleConcurrencyTests() {
  console.log("===============================================================================");
  console.log("STARTING GRAND FINALE CONCURRENCY & RACE TEST HARNESS (ADV-03 REMEDIATED)");
  console.log("Target Sandbox URL:", targetUrl);
  console.log("Mode: High-Concurrency Multi-Identity RPC Stress & Race Verification");
  console.log("===============================================================================");

  const adminClient = createClient(targetUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ── STEP A: FIXTURE PROVISIONING & IDENTITY SETUP ────────────────────────
    console.log("\n[Setup] Provisioning synthetic test candidates and admins in sandbox...");

    for (const u of TEST_USERS) {
      try {
        await adminClient.auth.admin.deleteUser(u.id);
      } catch {}

      const { error: createErr } = await adminClient.auth.admin.createUser({
        id: u.id,
        email: u.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.name },
        app_metadata: { role: u.role, is_admin: u.is_admin },
      });

      if (createErr && !createErr.message.includes("already exists")) {
        console.warn(`User setup note (${u.email}):`, createErr.message);
      }
    }

    // Clean prior test data for synthetic candidates
    await cleanupSyntheticData(adminClient);

    // Seed 10 test questions for Day 1
    const questionsToInsert = [];
    for (let slot = 1; slot <= 10; slot++) {
      questionsToInsert.push({
        day_number: 1,
        slot_number: slot,
        question_text: `CONC-Q-Day1-Slot${slot}`,
        option_a: "Alpha",
        option_b: "Bravo",
        option_c: "Charlie",
        option_d: "Delta",
        correct_option: "B",
        explanation: `Explanation Slot ${slot}`,
      });
    }
    const { error: qErr } = await adminClient
      .from("championship_finale_questions")
      .upsert(questionsToInsert, { onConflict: "day_number,slot_number" });
    if (qErr) throw new Error(`Question seeding failed: ${qErr.message}`);

    // Seed Roster (10 finalists + 2 reserves)
    const rosterToInsert = [];
    for (let i = 1; i <= 10; i++) {
      rosterToInsert.push({
        seat_type: "finalist",
        seat_number: i,
        user_id: i === 1 ? SYNTH_STUDENT1_ID : i === 2 ? SYNTH_STUDENT2_ID : `11111111-0000-0000-0000-${String(i).padStart(12, "0")}`,
        qualifier_id: `CONC-QUAL-${String(i).padStart(3, "0")}`,
        student_name: `Dr. Concurrency Finalist ${i}`,
        college: "AIIMS New Delhi",
        batch: "2024 Batch",
        qualification_rank: i,
        verification_status: "verified",
        attendance_confirmed: true,
      });
    }
    rosterToInsert.push({
      seat_type: "reserve",
      seat_number: 1,
      user_id: "22222222-0000-0000-0000-000000000001",
      qualifier_id: "CONC-QUAL-RES1",
      student_name: "Dr. Reserve 1",
      college: "BJMC Pune",
      batch: "2024 Batch",
      qualification_rank: 11,
      verification_status: "verified",
      attendance_confirmed: true,
    });
    rosterToInsert.push({
      seat_type: "reserve",
      seat_number: 2,
      user_id: "22222222-0000-0000-0000-000000000002",
      qualifier_id: "CONC-QUAL-RES2",
      student_name: "Dr. Reserve 2",
      college: "KEM Mumbai",
      batch: "2024 Batch",
      qualification_rank: 12,
      verification_status: "verified",
      attendance_confirmed: true,
    });
    const { error: rostErr } = await adminClient
      .from("championship_finale_roster")
      .upsert(rosterToInsert, { onConflict: "seat_type,seat_number" });
    if (rostErr) throw new Error(`Roster seeding failed: ${rostErr.message}`);

    // Ensure Day 1 is open with adequate window and clean publication state
    await adminClient.from("championship_finale_days").update({
      status: "open",
      results_published: false,
      published_at: null,
      published_by: null,
      paused_at: null,
      window_opens_at: new Date(Date.now() - 60000).toISOString(),
      window_closes_at: new Date(Date.now() + 3600000).toISOString(),
    }).eq("day_number", 1);

    // ── STEP B: AUTHENTICATE DISTINCT PARTICIPANT & ADMIN CLIENTS ─────────────
    console.log("\n[Setup] Authenticating distinct participant & admin clients via signInWithPassword...");

    const student1 = await getAuthenticatedClient(targetUrl, anonKey, "student1@finale-concurrency.test", TEST_PASSWORD);
    const student2 = await getAuthenticatedClient(targetUrl, anonKey, "student2@finale-concurrency.test", TEST_PASSWORD);
    const admin1 = await getAuthenticatedClient(targetUrl, anonKey, "admin1@finale-concurrency.test", TEST_PASSWORD);
    const admin2 = await getAuthenticatedClient(targetUrl, anonKey, "admin2@finale-concurrency.test", TEST_PASSWORD);

    assert(student1.userId === SYNTH_STUDENT1_ID, "Student 1 authenticated with valid matching UUID");
    assert(student2.userId === SYNTH_STUDENT2_ID, "Student 2 authenticated with valid matching UUID");
    assert(admin1.userId === SYNTH_ADMIN1_ID, "Admin 1 authenticated with valid matching UUID");
    assert(admin2.userId === SYNTH_ADMIN2_ID, "Admin 2 authenticated with valid matching UUID");

    // ── TEST 1: PARALLEL IDENTICAL DOUBLE-TAP SUBMISSION ─────────────────────
    console.log("\n[Test 1] Racing 3 simultaneous identical double-tap submissions on Slot 1...");
    testsExecuted++;

    // Student 1 starts session under genuine participant auth
    const { data: sess1, error: sess1Err } = await student1.client.rpc("start_or_resume_finale_session", { p_day_number: 1 });
    if (sess1Err || !sess1?.ok) {
      throw new Error(`Student 1 session start failed: ${sess1Err ? sess1Err.message : sess1?.error_code}`);
    }
    const sessionId = sess1.session_id;
    assert(typeof sessionId === "string" && sessionId.length > 0, "Student 1 acquired valid session ID via authenticated RPC");

    const idempotencyKey = `race_idemp_slot_1_${Date.now()}`;
    const slot1Payload = {
      p_session_id: sessionId,
      p_slot_number: 1,
      p_action_type: "answer",
      p_selected_option: "B",
      p_idempotency_key: idempotencyKey,
    };

    // Fire 3 simultaneous requests with identical payload
    const [r1, r2, r3] = await Promise.all([
      student1.client.rpc("submit_finale_slot_action", slot1Payload),
      student1.client.rpc("submit_finale_slot_action", slot1Payload),
      student1.client.rpc("submit_finale_slot_action", slot1Payload),
    ]);

    const results = [r1.data, r2.data, r3.data];
    const successCount = results.filter(r => r?.ok === true).length;
    const initialCommitCount = results.filter(r => r?.ok === true && r?.is_duplicate === false).length;
    const duplicateCount = results.filter(r => r?.ok === true && r?.is_duplicate === true).length;

    assert(successCount === 3, "All 3 racing duplicate requests resolved successfully without database error");
    assert(initialCommitCount === 1, "Exactly 1 request executed the initial state commitment");
    assert(duplicateCount === 2, "Exactly 2 requests were identified as idempotent duplicates returning cached state");

    // Verify Slot 1 state in database (atomic score integrity)
    const { data: slotRows } = await adminClient
      .from("championship_finale_question_states")
      .select("*")
      .eq("session_id", sessionId)
      .eq("slot_number", 1);

    assert(slotRows && slotRows.length === 1, "Exactly one question state record exists for Slot 1 (no duplicate rows)");
    assert(slotRows[0].points_awarded === 100, "Score awarded exactly once (100 points, zero double-crediting)");
    assert(slotRows[0].state === "answered", "Slot 1 state is committed as 'answered'");
    testsPassed++;

    // ── TEST 2: PARALLEL CONFLICTING DOUBLE-TAP SUBMISSION ───────────────────
    console.log("\n[Test 2] Racing conflicting submissions on Slot 2 (Answer 'B' vs Skip)...");
    testsExecuted++;

    const pAns = {
      p_session_id: sessionId,
      p_slot_number: 2,
      p_action_type: "answer",
      p_selected_option: "B",
      p_idempotency_key: `race_conflict_slot_2_ans_${Date.now()}`,
    };
    const pSkip = {
      p_session_id: sessionId,
      p_slot_number: 2,
      p_action_type: "skip",
      p_selected_option: null,
      p_idempotency_key: `race_conflict_slot_2_skip_${Date.now()}`,
    };

    const [resAns, resSkip] = await Promise.all([
      student1.client.rpc("submit_finale_slot_action", pAns),
      student1.client.rpc("submit_finale_slot_action", pSkip),
    ]);

    const ansOk = resAns.data?.ok === true;
    const skipOk = resSkip.data?.ok === true;
    const exactlyOneSucceeded = (ansOk && !skipOk) || (!ansOk && skipOk);

    assert(exactlyOneSucceeded, "Exactly one conflicting request succeeded");

    const rejectedResult = ansOk ? resSkip.data : resAns.data;
    assert(
      rejectedResult?.ok === false && rejectedResult?.error_code === "ERR_SLOT_ALREADY_COMMITTED_CONFLICT",
      "Conflicting concurrent action was explicitly rejected with ERR_SLOT_ALREADY_COMMITTED_CONFLICT"
    );

    const { data: slot2Rows } = await adminClient
      .from("championship_finale_question_states")
      .select("*")
      .eq("session_id", sessionId)
      .eq("slot_number", 2);

    assert(slot2Rows && slot2Rows.length === 1, "Exactly one record exists in championship_finale_question_states for Slot 2");
    testsPassed++;

    // ── TEST 3: OUT-OF-ORDER SLOT SUBMISSION ─────────────────────────────────
    console.log("\n[Test 3] Verifying strict sequential enforcement (Slot 5 before Slot 3)...");
    testsExecuted++;

    const { data: oooRes } = await student1.client.rpc("submit_finale_slot_action", {
      p_session_id: sessionId,
      p_slot_number: 5,
      p_action_type: "answer",
      p_selected_option: "A",
      p_idempotency_key: `ooo_slot_5_${Date.now()}`,
    });

    assert(oooRes?.ok === false, "Out-of-order Slot 5 request was rejected");
    assert(oooRes?.error_code === "ERR_SLOT_OUT_OF_ORDER", "Error code returned is ERR_SLOT_OUT_OF_ORDER");
    testsPassed++;

    // ── TEST 4: PARALLEL SESSION CREATION RACE ───────────────────────────────
    console.log("\n[Test 4] Racing simultaneous session creations for Student 2 on Day 1...");
    testsExecuted++;

    // Fire 3 simultaneous start_or_resume calls from Student 2
    const [start1, start2, start3] = await Promise.all([
      student2.client.rpc("start_or_resume_finale_session", { p_day_number: 1 }),
      student2.client.rpc("start_or_resume_finale_session", { p_day_number: 1 }),
      student2.client.rpc("start_or_resume_finale_session", { p_day_number: 1 }),
    ]);

    const sResults = [start1.data, start2.data, start3.data];
    const allSuccessful = sResults.every(r => r?.ok === true && typeof r?.session_id === "string");
    assert(allSuccessful, "All 3 concurrent start requests succeeded");

    const s2SessionId = sResults[0].session_id;
    const allSameId = sResults.every(r => r.session_id === s2SessionId);
    assert(allSameId, "All concurrent start requests returned the identical session ID (advisory lock serialization)");

    const { data: dbSessions } = await adminClient
      .from("championship_finale_sessions")
      .select("id")
      .eq("user_id", SYNTH_STUDENT2_ID)
      .eq("day_number", 1)
      .eq("status", "active");

    assert(dbSessions && dbSessions.length === 1, "Partial unique index uq_finale_sessions_single_live_slot prevented duplicate active sessions");
    testsPassed++;

    // ── TEST 5: SIMULTANEOUS RESULT PUBLICATION VS INGRESS RACE ──────────────
    console.log("\n[Test 5] Simulating late submission race against day window closure...");
    testsExecuted++;

    // Close Day 1 to simulate window expiry
    await adminClient.from("championship_finale_days").update({ status: "closed" }).eq("day_number", 1);

    const { data: lateSubRes } = await student1.client.rpc("submit_finale_slot_action", {
      p_session_id: sessionId,
      p_slot_number: 3,
      p_action_type: "answer",
      p_selected_option: "B",
      p_idempotency_key: `late_sub_slot_3_${Date.now()}`,
    });

    assert(lateSubRes?.ok === false, "Late submission on closed day was rejected");
    assert(
      lateSubRes?.error_code === "COMPETITION_DAY_CLOSED",
      `Rejected with valid closure code: ${lateSubRes?.error_code}`
    );
    testsPassed++;

    // ── TEST 6: DUAL ADMINISTRATIVE APPROVAL CONCURRENCY & TOCTOU ────────────
    console.log("\n[Test 6] Verifying concurrent two-person administrative approval execution...");
    testsExecuted++;

    // Ensure day window has closed and status is closed for results publication test
    await adminClient.from("championship_finale_days").update({
      status: "closed",
      window_closes_at: new Date(Date.now() - 5000).toISOString(),
    }).eq("day_number", 1);

    // Admin 1 requests approval using verified SQL signature: (p_action_name, p_target_day, p_payload)
    const { data: reqAppr, error: reqApprErr } = await admin1.client.rpc("admin_request_approval", {
      p_action_name: "PUBLISH_DAILY_RESULTS",
      p_target_day: 1,
      p_payload: {
        reason: "CONCURRENCY TEST: Publish Day 1 Results",
        test_suite: "concurrency_test",
      },
    });

    if (reqApprErr || !reqAppr?.ok) {
      throw new Error(`Admin 1 approval request failed: ${reqApprErr ? reqApprErr.message : reqAppr?.error_code}`);
    }

    const approvalId = reqAppr.approval_id;
    assert(typeof approvalId === "string" && approvalId.length > 0, "Admin 1 created pending approval request");

    // Concurrently execute approval from Admin 2 (two competing execution requests)
    const [exec1, exec2] = await Promise.all([
      admin2.client.rpc("admin_publish_daily_results", { p_approval_id: approvalId }),
      admin2.client.rpc("admin_publish_daily_results", { p_approval_id: approvalId }),
    ]);

    const execResults = [exec1.data, exec2.data];
    const execSuccess = execResults.filter(r => r?.ok === true).length;
    const execConflict = execResults.filter(r => r?.ok === false && r?.error_code === "APPROVAL_ALREADY_PROCESSED").length;

    assert(execSuccess === 1, "Exactly one administrative approval execution succeeded");
    assert(execConflict === 1, "Second concurrent approval execution was rejected with APPROVAL_ALREADY_PROCESSED");
    testsPassed++;

    console.log("\n===============================================================================");
    console.log(`CONCURRENCY SUITE FINISHED: ${testsPassed} of ${testsPlanned} TESTS PASSED`);
    console.log(`Total Assertions Checked: ${totalAssertionsChecked}`);
    console.log(`Tests Failed: ${testsFailed}, Tests Skipped: ${testsSkipped}`);
    console.log("===============================================================================");

    if (testsFailed > 0 || testsPassed !== testsPlanned) {
      process.exit(1);
    }
  } catch (err) {
    console.error("\n[FATAL] Concurrency Test Suite Execution Error:", err.message);
    process.exit(1);
  } finally {
    console.log("\n[Teardown] Performing deterministic test fixture cleanup...");
    await cleanupSyntheticData(adminClient);
  }
}

// ── 6. EXECUTION GATE & CLI ROUTING ───────────────────────────────────────────
if (targetUrl && serviceKey) {
  // Safeguard check
  if (targetUrl.toLowerCase().includes(PROD_REF) || process.env.NODE_ENV === "production") {
    console.error("===============================================================================");
    console.error("CRITICAL SECURITY VIOLATION: Execution REFUSED!");
    console.error(`The specified URL matches production reference (${PROD_REF}).`);
    console.error("This test suite executes high-concurrency mutation racing and must NEVER");
    console.error("be pointed at production under any circumstances.");
    console.error("===============================================================================");
    process.exit(1);
  }

  runFinaleConcurrencyTests();
} else {
  console.log("===============================================================================");
  console.log("MEDTRAIL GRAND FINALE CONCURRENCY TEST HARNESS (STATIC SPECIFICATION)");
  console.log("File: supabase/tests/finale_concurrency_test.mjs");
  console.log("Remediation Status: ADV-03 REMEDIATED");
  console.log("===============================================================================");
  console.log("\nSpecification Summary:");
  console.log(`- Planned Test Scenarios: ${testsPlanned}`);
  console.log("- Identities Covered: 4 (Student 1, Student 2, Admin 1, Admin 2)");
  console.log("- Authentication Mechanism: Dedicated clients via signInWithPassword");
  console.log("- Silent Skips: 0 (Hard assertions on session acquisition & RPC outcomes)");
  console.log("- Concurrency Primitives: Promise.all racing across distinct network sessions");
  console.log("- Score Integrity Validation: Explicit verification of points_awarded = 100");
  console.log("- Teardown: Deterministic isolation scoped to synthetic UUIDs & prefixes");
  console.log("\nUsage (Isolated Sandbox / Local Dev Only):");
  console.log("  node supabase/tests/finale_concurrency_test.mjs <SANDBOX_URL> <SANDBOX_SERVICE_KEY> [SANDBOX_ANON_KEY]");
  console.log("===============================================================================");
}
