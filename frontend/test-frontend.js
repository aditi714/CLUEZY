// Automated Frontend Test Suite for CluezyAPI (frontend/assets/js/cluezy-api.js)
const assert = require("assert");

// Mock browser globals (localStorage, window, document, fetch)
const storageMap = new Map();
global.localStorage = {
  getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k),
  clear: () => storageMap.clear(),
};

global.window = {
  localStorage: global.localStorage,
  location: {
    protocol: "http:",
    hostname: "localhost",
    pathname: "/investigation/",
    search: "",
  },
  CLUEZY_CONFIG: {
    API_BASE_URL: "http://localhost:8000/api/v1",
  },
};

global.document = {
  querySelector: () => null,
};

const CluezyAPI = require("./assets/js/cluezy-api.js");

let fetchResponder = null;
const recordedCalls = [];

global.fetch = async (url, options) => {
  recordedCalls.push({ url, options });
  if (!fetchResponder) {
    throw new Error("No mock fetchResponder configured");
  }
  return await fetchResponder(url, options);
};

function makeJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function runTests() {
  console.log("=== Running CLUEZY Frontend Unit & Integration Tests ===");
  let passed = 0;

  // Test 1: Session creation and persistence in localStorage
  {
    storageMap.clear();
    recordedCalls.length = 0;
    fetchResponder = async (url, opts) => {
      assert.strictEqual(url, "http://localhost:8000/api/v1/sessions");
      assert.strictEqual(opts.method, "POST");
      return makeJsonResponse(200, {
        success: true,
        data: {
          id: "11111111-1111-1111-1111-111111111111",
          session_token: "clz_test_token_123",
          user_identifier: "Parth",
          daily_token_limit: 200000,
          tokens_used: 0,
          remaining_tokens: 200000,
          remaining_percentage: 100.0,
          is_active: true,
        },
      });
    };

    const sess = await CluezyAPI.getOrCreateSession();
    assert.strictEqual(sess.session_token, "clz_test_token_123");
    assert.strictEqual(CluezyAPI.getSessionToken(), "clz_test_token_123");
    assert.strictEqual(localStorage.getItem("cluezy_session_token"), "clz_test_token_123");
    console.log("  [PASS] 1. Anonymous session creation and localStorage persistence");
    passed++;
  }

  // Test 2: Investigation creation attaches X-Session-Token and stores current investigation ID
  {
    recordedCalls.length = 0;
    fetchResponder = async (url, opts) => {
      if (url.endsWith("/sessions/me")) {
        return makeJsonResponse(200, {
          success: true,
          data: { session_token: "clz_test_token_123", remaining_percentage: 99 },
        });
      }
      assert.strictEqual(url, "http://localhost:8000/api/v1/investigations");
      assert.strictEqual(opts.method, "POST");
      assert.strictEqual(opts.headers["X-Session-Token"], "clz_test_token_123");
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.problem_description, "Wi-Fi connected on Windows laptop, websites do not open.");
      return makeJsonResponse(201, {
        success: true,
        data: {
          id: "22222222-2222-2222-2222-222222222222",
          reference_id: "INV-4012",
          title: "Wi-Fi connected, websites do not open",
          status: "active",
          messages: [
            { sender: "user", content: body.problem_description },
            {
              sender: "assistant",
              content: "First diagnostic check: try opening https://1.1.1.1",
              suggested_responses: ["It opens", "It doesn't open", "I'm not sure"],
              extra_data: { question_id: "check_ip_access" },
            },
          ],
          evidence: [{ category: "network", key: "Network", value: "Wi-Fi connected" }],
          candidate_causes: [{ title: "DNS Resolution Failure", likelihood: "High", confidence_score: 0.65 }],
          recommended_actions: [{ id: "act-1", title: "Check 1.1.1.1", status: "pending" }],
        },
      });
    };

    const inv = await CluezyAPI.createInvestigation("Wi-Fi connected on Windows laptop, websites do not open.");
    assert.strictEqual(inv.reference_id, "INV-4012");
    assert.strictEqual(CluezyAPI.getCurrentInvestigationId(), "INV-4012");
    console.log("  [PASS] 2. Investigation creation and X-Session-Token header injection");
    passed++;
  }

  // Test 3: Quick-reply diagnostic answer submission
  {
    recordedCalls.length = 0;
    fetchResponder = async (url, opts) => {
      if (url.endsWith("/sessions/me")) {
        return makeJsonResponse(200, {
          success: true,
          data: { session_token: "clz_test_token_123", remaining_percentage: 98 },
        });
      }
      assert.strictEqual(url, "http://localhost:8000/api/v1/investigations/INV-4012/progress");
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.question_id, "check_ip_access");
      assert.strictEqual(body.selected_option_value, "It opens");
      return makeJsonResponse(200, {
        success: true,
        data: {
          reference_id: "INV-4012",
          status: "testing_solution",
          candidate_causes: [{ title: "DNS Resolution Failure", likelihood: "High", confidence_score: 0.85 }],
          recommended_actions: [
            {
              id: "act-2",
              title: "Change DNS to Google Public DNS (8.8.8.8 and 8.8.4.4)",
              status: "pending",
              steps: ["Open Network Settings", "Set DNS to 8.8.8.8"],
            },
          ],
        },
      });
    };

    const progressed = await CluezyAPI.submitDiagnosticAnswer("INV-4012", "check_ip_access", "It opens");
    assert.strictEqual(progressed.status, "testing_solution");
    assert.strictEqual(progressed.candidate_causes[0].likelihood, "High");
    console.log("  [PASS] 3. Quick-reply diagnostic answer submission");
    passed++;
  }

  // Test 4: Custom message submission and duplicate submission guard
  {
    let releasePromise;
    fetchResponder = async (url) => {
      if (url.endsWith("/sessions/me")) {
        return makeJsonResponse(200, {
          success: true,
          data: { session_token: "clz_test_token_123" },
        });
      }
      await new Promise((resolve) => {
        releasePromise = resolve;
      });
      return makeJsonResponse(200, {
        success: true,
        data: { reference_id: "INV-4012", status: "active" },
      });
    };

    const firstCall = CluezyAPI.submitMessage("INV-4012", "I tested pinging 1.1.1.1 and got replies.");
    let duplicateBlocked = false;
    try {
      await CluezyAPI.submitMessage("INV-4012", "Duplicate click while in flight");
    } catch (err) {
      if (err.code === "DUPLICATE_REQUEST") {
        duplicateBlocked = true;
      }
    }
    assert.strictEqual(duplicateBlocked, true, "Duplicate concurrent submission must be blocked");
    releasePromise();
    const res = await firstCall;
    assert.strictEqual(res.reference_id, "INV-4012");
    console.log("  [PASS] 4. Custom message submission and duplicate-submission protection");
    passed++;
  }

  // Test 5: Solution outcome handling (failed outcome continues investigation, working awaits confirmation)
  {
    fetchResponder = async (url, opts) => {
      if (url.endsWith("/sessions/me")) {
        return makeJsonResponse(200, {
          success: true,
          data: { session_token: "clz_test_token_123" },
        });
      }
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.action_id, "act-2");
      assert.strictEqual(body.action_outcome, "not_working");
      return makeJsonResponse(200, {
        success: true,
        data: {
          reference_id: "INV-4012",
          status: "active",
          messages: [
            {
              sender: "assistant",
              content: "Are other devices able to open websites on the same Wi-Fi?",
              extra_data: { question_id: "check_other_devices" },
            },
          ],
        },
      });
    };

    const afterFailedFix = await CluezyAPI.submitActionOutcome("INV-4012", "act-2", "not_working");
    assert.strictEqual(afterFailedFix.status, "active");
    console.log("  [PASS] 5. Failed solution outcome handling continues troubleshooting");
    passed++;
  }

  // Test 6: Explicit resolution confirmation and report retrieval
  {
    fetchResponder = async (url, opts) => {
      if (url.endsWith("/sessions/me")) {
        return makeJsonResponse(200, {
          success: true,
          data: { session_token: "clz_test_token_123" },
        });
      }
      assert.strictEqual(url, "http://localhost:8000/api/v1/investigations/INV-4012/resolve");
      assert.strictEqual(opts.method, "POST");
      return makeJsonResponse(200, {
        success: true,
        data: {
          reference_id: "INV-4012",
          status: "resolved",
          report: {
            title: "Resolution Report: Wi-Fi connected, websites do not open",
            root_cause: "DNS Resolution Failure",
            fix_applied: "Change DNS to Google Public DNS (8.8.8.8 and 8.8.4.4)",
            summary: "Resolved by configuring Google Public DNS.",
          },
        },
      });
    };

    const resolvedInv = await CluezyAPI.confirmResolution("INV-4012", "Confirmed working.");
    assert.strictEqual(resolvedInv.status, "resolved");
    assert.strictEqual(resolvedInv.report.root_cause, "DNS Resolution Failure");
    console.log("  [PASS] 6. Explicit resolution confirmation and report generation");
    passed++;
  }

  // Test 7: Investigation restoration from URL query parameter after page refresh
  {
    global.window.location.search = "?id=INV-4012";
    fetchResponder = async (url) => {
      assert.strictEqual(url, "http://localhost:8000/api/v1/investigations/INV-4012");
      return makeJsonResponse(200, {
        success: true,
        data: {
          reference_id: "INV-4012",
          status: "resolved",
          messages: [{ sender: "user", content: "Restored message" }],
        },
      });
    };

    const restoredId = CluezyAPI.getCurrentInvestigationId();
    assert.strictEqual(restoredId, "INV-4012");
    const restoredInv = await CluezyAPI.getInvestigation();
    assert.strictEqual(restoredInv.messages[0].content, "Restored message");
    console.log("  [PASS] 7. Investigation state restoration across browser refresh");
    passed++;
  }

  // Test 8: Automatic 401 session expiration recovery and error handling
  {
    let attempts = 0;
    fetchResponder = async (url) => {
      attempts++;
      if (attempts === 1) {
        return makeJsonResponse(401, {
          success: false,
          error: { code: "SESSION_EXPIRED", message: "Session expired" },
        });
      }
      if (url.endsWith("/sessions")) {
        return makeJsonResponse(200, {
          success: true,
          data: { session_token: "clz_regenerated_token_999" },
        });
      }
      return makeJsonResponse(200, {
        success: true,
        data: { items: [{ reference_id: "INV-4012" }], total: 1 },
      });
    };

    const listRes = await CluezyAPI.listInvestigations();
    assert.strictEqual(CluezyAPI.getSessionToken(), "clz_regenerated_token_999");
    assert.strictEqual(listRes.total, 1);
    console.log("  [PASS] 8. Automatic 401 session expiration recovery & history listing");
    passed++;
  }

  // Test 9: Supabase client initialization and Google OAuth sign-in initiation
  {
    let oauthProvider = null;
    let oauthOptions = null;
    const mockSupabase = {
      auth: {
        signInWithOAuth: async (opts) => {
          oauthProvider = opts.provider;
          oauthOptions = opts.options;
          return { data: { provider: "google", url: "https://accounts.google.com/o/oauth2" }, error: null };
        },
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    };

    CluezyAPI.setSupabaseClient(mockSupabase);
    const oauthRes = await CluezyAPI.signInWithGoogle("/investigation/");
    assert.strictEqual(oauthProvider, "google");
    assert.ok(oauthOptions.redirectTo.includes("/investigation/"));
    assert.strictEqual(oauthRes.provider, "google");
    console.log("  [PASS] 9. Supabase Google OAuth sign-in initiation");
    passed++;
  }

  // Test 10: Automatic Bearer token injection when authenticated
  {
    recordedCalls.length = 0;
    const mockSession = {
      access_token: "mock_jwt_access_token_xyz_123",
      user: {
        id: "usr_9999",
        email: "aditi@gmail.com",
        user_metadata: { full_name: "Aditi" },
      },
    };

    const mockSupabase = {
      auth: {
        getSession: async () => ({ data: { session: mockSession }, error: null }),
        getUser: async () => ({ data: { user: mockSession.user }, error: null }),
        signOut: async () => ({ error: null }),
      },
    };

    CluezyAPI.setSupabaseClient(mockSupabase);

    fetchResponder = async (url, opts) => {
      assert.strictEqual(opts.headers["Authorization"], "Bearer mock_jwt_access_token_xyz_123");
      return makeJsonResponse(200, {
        success: true,
        data: { items: [], total: 0 },
      });
    };

    const isAuth = await CluezyAPI.isAuthenticated();
    assert.strictEqual(isAuth, true);
    const user = await CluezyAPI.getAuthUser();
    assert.strictEqual(user.email, "aditi@gmail.com");

    await CluezyAPI.listInvestigations();
    assert.strictEqual(recordedCalls.length, 1);
    console.log("  [PASS] 10. Automatic Bearer token injection when authenticated");
    passed++;
  }

  // Test 11: Claiming anonymous investigations attaches session token to claim endpoint
  {
    recordedCalls.length = 0;
    CluezyAPI.setSessionToken("clz_anon_to_claim_456");

    fetchResponder = async (url, opts) => {
      assert.ok(url.endsWith("/investigations/claim-anonymous"));
      assert.strictEqual(opts.method, "POST");
      assert.strictEqual(opts.headers["Authorization"], "Bearer mock_jwt_access_token_xyz_123");
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.session_token, "clz_anon_to_claim_456");
      return makeJsonResponse(200, {
        success: true,
        data: {
          claimed_count: 2,
          reference_ids: ["INV-1001", "INV-1002"],
          message: "Linked successfully",
        },
      });
    };

    const claimRes = await CluezyAPI.claimAnonymousInvestigations();
    assert.strictEqual(claimRes.claimed_count, 2);
    assert.strictEqual(claimRes.reference_ids[0], "INV-1001");
    console.log("  [PASS] 11. Anonymous investigation claiming and account linking");
    passed++;
  }

  // Test 12: Sign-out invokes Supabase signOut and clears auth state
  {
    let signOutCalled = false;
    const mockSupabase = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        signOut: async () => {
          signOutCalled = true;
          return { error: null };
        },
      },
    };
    CluezyAPI.setSupabaseClient(mockSupabase);
    await CluezyAPI.signOut();
    assert.strictEqual(signOutCalled, true);
    const tokenAfter = await CluezyAPI.getAuthToken();
    assert.strictEqual(tokenAfter, null);
    console.log("  [PASS] 12. Sign out flow and auth credential clearing");
    passed++;
  }

  // Test 13: 401 token refresh retry flow
  {
    let refreshAttempted = false;
    let requestCount = 0;
    const refreshedSession = {
      access_token: "mock_refreshed_token_777",
      user: { id: "usr_9999", email: "aditi@gmail.com" },
    };

    let activeSession = {
      access_token: "expired_token_111",
      user: { id: "usr_9999", email: "aditi@gmail.com" },
    };

    const mockSupabase = {
      auth: {
        getSession: async () => ({ data: { session: activeSession }, error: null }),
        getUser: async () => ({ data: { user: activeSession.user }, error: null }),
        refreshSession: async () => {
          refreshAttempted = true;
          activeSession = refreshedSession;
          return { data: { session: refreshedSession }, error: null };
        },
      },
    };
    CluezyAPI.setSupabaseClient(mockSupabase);

    fetchResponder = async (url, opts) => {
      requestCount++;
      if (requestCount === 1) {
        assert.strictEqual(opts.headers["Authorization"], "Bearer expired_token_111");
        return makeJsonResponse(401, {
          success: false,
          error: { code: "TOKEN_EXPIRED", message: "JWT expired" },
        });
      }
      assert.strictEqual(opts.headers["Authorization"], "Bearer mock_refreshed_token_777");
      return makeJsonResponse(200, {
        success: true,
        data: { items: [], total: 0 },
      });
    };

    await CluezyAPI.listInvestigations();
    assert.strictEqual(refreshAttempted, true);
    assert.strictEqual(requestCount, 2);
    console.log("  [PASS] 13. Automatic 401 JWT refresh and seamless request retry");
    passed++;
  }

  console.log(`\nAll ${passed} frontend tests PASSED!`);
}

runTests().catch((err) => {
  console.error("Frontend test failed:", err);
  process.exit(1);
});

