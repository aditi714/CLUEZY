/**
 * CLUEZY Frontend API Client Bridge (cluezy-api.js)
 *
 * Lightweight, zero-dependency API client connecting the Cluezy frontend
 * to the FastAPI backend. Manages anonymous session tokens, request timeouts,
 * duplicate submission guards, and active investigation persistence.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CluezyAPI = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  var STORAGE_KEYS = {
    SESSION_TOKEN: "cluezy_session_token",
    SESSION_DATA: "cluezy_session_data",
    CURRENT_INV_ID: "cluezy_current_investigation_id",
    SAVED_FIXES: "cluezy_saved_fixes",
    DRAFT_PROBLEM: "cluezy_draft_problem",
    API_BASE_OVERRIDE: "cluezy_api_base_url",
  };

  var SUPABASE_URL = "https://vxaupjnubimtqcuittbv.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_OZPJ4Az7-VusxfzUqupR6w_UB-RI5WC";

  var SESSION_HEADER = "X-Session-Token";
  var DEFAULT_TIMEOUT_MS = 35000;

  /**
   * Resolve the API Base URL dynamically based on environment configuration.
   * - Priority 1: Explicit runtime config (window.CLUEZY_CONFIG.API_BASE_URL)
   * - Priority 2: <meta name="cluezy-api-base" content="...">
   * - Priority 3: localStorage override (for custom staging testing)
   * - Priority 4: Local development detection (localhost / 127.0.0.1 / file:) -> http://localhost:8000/api/v1
   * - Priority 5: Production deployment relative path (/api/v1)
   */
  function resolveApiBaseUrl() {
    if (typeof window !== "undefined") {
      if (window.CLUEZY_CONFIG && window.CLUEZY_CONFIG.API_BASE_URL) {
        return window.CLUEZY_CONFIG.API_BASE_URL.replace(/\/+$/, "");
      }
      if (typeof document !== "undefined") {
        var meta = document.querySelector('meta[name="cluezy-api-base"]');
        if (meta && meta.getAttribute("content")) {
          return meta.getAttribute("content").replace(/\/+$/, "");
        }
      }
      try {
        var override = window.localStorage.getItem(STORAGE_KEYS.API_BASE_OVERRIDE);
        if (override) {
          return override.replace(/\/+$/, "");
        }
      } catch (_e) {}

      var loc = window.location;
      if (
        loc.protocol === "file:" ||
        loc.hostname === "localhost" ||
        loc.hostname === "127.0.0.1"
      ) {
        return "http://localhost:8000/api/v1";
      }
    }
    return "/api/v1";
  }

  var memoryStorage = {};

  function safeStorageGet(key) {
    try {
      if (typeof localStorage !== "undefined") {
        var v = localStorage.getItem(key);
        if (v !== null) return v;
      }
    } catch (_e) {}
    return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : null;
  }

  function safeStorageSet(key, value) {
    try {
      if (typeof localStorage !== "undefined") {
        if (value === null || value === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, value);
        }
      }
    } catch (_e) {}
    if (value === null || value === undefined) {
      delete memoryStorage[key];
    } else {
      memoryStorage[key] = String(value);
    }
  }

  // Track in-flight mutating requests to prevent duplicate submissions
  var inFlightMutations = new Set();
  var sessionInitPromise = null;
  var supabaseInstance = null;

  function getSupabaseClient() {
    if (supabaseInstance) return supabaseInstance;
    var supabaseLib = null;
    if (typeof window !== "undefined") {
      if (window.supabase && typeof window.supabase.createClient === "function") {
        supabaseLib = window.supabase;
      }
    } else if (typeof globalThis !== "undefined" && globalThis.supabase) {
      supabaseLib = globalThis.supabase;
    }
    if (supabaseLib && typeof supabaseLib.createClient === "function") {
      try {
        var url = (typeof window !== "undefined" && window.CLUEZY_CONFIG && window.CLUEZY_CONFIG.SUPABASE_URL) || SUPABASE_URL;
        var anonKey = (typeof window !== "undefined" && window.CLUEZY_CONFIG && window.CLUEZY_CONFIG.SUPABASE_PUBLISHABLE_KEY) || SUPABASE_PUBLISHABLE_KEY;
        supabaseInstance = supabaseLib.createClient(url, anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: "cluezy_auth_token",
          },
        });
      } catch (e) {
        console.warn("Failed initializing Supabase client:", e);
      }
    }
    return supabaseInstance;
  }

  // =========================================================================
  // Offline Intelligent Diagnostic Engine (Resilient fallback when backend sleeps)
  // =========================================================================
  var OfflineInvestigationEngine = {
    create: function (problemDescription, meta) {
      meta = meta || {};
      var id = "OFFLINE-" + Math.random().toString(36).substring(2, 8).toUpperCase();
      var lower = (problemDescription || "").toLowerCase();
      var category = "Hardware & System";
      var causes = [];
      var firstQuestion = "";
      var quickReplies = [];

      if (
        lower.indexOf("wifi") >= 0 ||
        lower.indexOf("wi-fi") >= 0 ||
        lower.indexOf("internet") >= 0 ||
        lower.indexOf("dns") >= 0 ||
        lower.indexOf("network") >= 0 ||
        lower.indexOf("connection") >= 0
      ) {
        category = "Network & Wi-Fi";
        causes = [
          { id: "c1", title: "Local DNS resolver or DHCP lease configuration fault", probability: 0.76, status: "suspected" },
          { id: "c2", title: "Wi-Fi adapter power-save or driver glitch", probability: 0.52, status: "suspected" },
          { id: "c3", title: "Gateway router upstream connection stall", probability: 0.34, status: "suspected" }
        ];
        firstQuestion = "I've started an investigation for your connectivity issue. Are other devices (like your phone) connected to the same Wi-Fi and able to load websites?";
        quickReplies = ["Yes, other devices work", "No, all devices have no internet", "Connected with 'No Internet' status"];
      } else if (
        lower.indexOf("screen") >= 0 ||
        lower.indexOf("display") >= 0 ||
        lower.indexOf("flicker") >= 0 ||
        lower.indexOf("monitor") >= 0 ||
        lower.indexOf("graphics") >= 0
      ) {
        category = "Hardware & System";
        causes = [
          { id: "c1", title: "Display driver corruption or refresh rate mismatch", probability: 0.72, status: "suspected" },
          { id: "c2", title: "Application GPU hardware acceleration conflict", probability: 0.48, status: "suspected" },
          { id: "c3", title: "Display ribbon cable connection wear", probability: 0.28, status: "suspected" }
        ];
        firstQuestion = "Does the screen flickering happen across all open windows, or only inside specific applications (like Google Chrome or video games)?";
        quickReplies = ["Happens everywhere across OS", "Only in browser or video", "Happens when tilting laptop screen"];
      } else if (
        lower.indexOf("audio") >= 0 ||
        lower.indexOf("sound") >= 0 ||
        lower.indexOf("speaker") >= 0 ||
        lower.indexOf("mic") >= 0 ||
        lower.indexOf("volume") >= 0
      ) {
        category = "Audio & Video";
        causes = [
          { id: "c1", title: "Audio output endpoint routed incorrectly or muted", probability: 0.74, status: "suspected" },
          { id: "c2", title: "Operating system audio daemon service halted", probability: 0.46, status: "suspected" }
        ];
        firstQuestion = "Do you hear any sound if you plug in wired headphones or connect to Bluetooth audio?";
        quickReplies = ["Headphones work, built-in speakers don't", "No sound through any output", "Audio is distorted or crackling"];
      } else {
        category = "General Diagnostics";
        causes = [
          { id: "c1", title: "Background process deadlock or high resource load", probability: 0.65, status: "suspected" },
          { id: "c2", title: "System dependency or file permission conflict", probability: 0.42, status: "suspected" }
        ];
        firstQuestion = "Did this issue begin immediately after a recent update, software installation, or system reboot?";
        quickReplies = ["Yes, after a recent update", "No, started suddenly", "It happens intermittently"];
      }

      var inv = {
        id: id,
        reference_id: id,
        title: problemDescription.substring(0, 50) + (problemDescription.length > 50 ? "…" : ""),
        problem_description: problemDescription,
        category: category,
        status: "in_progress",
        is_offline_fallback: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        evidence: [
          { id: "e1", key: "Problem", label: "Reported Symptom", value: problemDescription.substring(0, 60), status: "confirmed" },
          { id: "e2", key: "Engine", label: "Diagnostic Mode", value: "Offline Heuristic Fallback", status: "confirmed" }
        ],
        candidate_causes: causes,
        recommended_actions: [
          { id: "a1", title: "Isolate failure domain", description: "Answer the diagnostic question to isolate whether the issue is local or external.", status: "pending", action_type: "manual", step_order: 1 }
        ],
        messages: [
          {
            id: "m1",
            sender: "user",
            text: problemDescription,
            created_at: new Date().toISOString()
          },
          {
            id: "m2",
            sender: "assistant",
            text: firstQuestion,
            created_at: new Date(Date.now() + 200).toISOString(),
            extra_data: {
              question_id: "q1",
              quick_replies: quickReplies
            }
          }
        ]
      };
      this.save(inv);
      return inv;
    },

    get: function (id) {
      var raw = safeStorageGet("cluezy_offline_inv_" + id);
      return raw ? JSON.parse(raw) : null;
    },

    save: function (inv) {
      if (inv && inv.reference_id) {
        safeStorageSet("cluezy_offline_inv_" + inv.reference_id, JSON.stringify(inv));
        var listRaw = safeStorageGet("cluezy_offline_inv_list");
        var list = listRaw ? JSON.parse(listRaw) : [];
        if (list.indexOf(inv.reference_id) === -1) {
          list.unshift(inv.reference_id);
          safeStorageSet("cluezy_offline_inv_list", JSON.stringify(list));
        }
      }
    },

    list: function () {
      var listRaw = safeStorageGet("cluezy_offline_inv_list");
      var ids = listRaw ? JSON.parse(listRaw) : [];
      var self = this;
      return ids.map(function (id) {
        var inv = self.get(id);
        if (!inv) return null;
        return {
          id: inv.id,
          reference_id: inv.reference_id,
          title: inv.title,
          problem_description: inv.problem_description,
          status: inv.status,
          category: inv.category,
          created_at: inv.created_at,
          updated_at: inv.updated_at,
          message_count: inv.messages ? inv.messages.length : 0,
        };
      }).filter(Boolean);
    },

    progress: function (id, userMessage, optionValue, actionOutcome) {
      var inv = this.get(id);
      if (!inv) return null;
      var text = (userMessage || optionValue || "").trim();
      if (text) {
        inv.messages.push({
          id: "m_" + Date.now(),
          sender: "user",
          text: text,
          created_at: new Date().toISOString()
        });
      }

      var turnCount = inv.messages.filter(function (m) { return m.sender === "assistant"; }).length;
      var replyText = "";
      var qReplies = [];
      var nextAction = null;

      if (turnCount === 1) {
        replyText = "Thanks for confirming. That narrows down the cause to this device's configuration. Let's test the primary recommended fix:";
        qReplies = ["Yes, this resolved the issue", "No, still having the problem", "Need alternate instructions"];
        inv.status = "testing_solution";

        if (inv.category === "Network & Wi-Fi") {
          nextAction = {
            id: "a2",
            title: "Flush DNS cache & reset network stack",
            description: "Open Command Prompt as Admin and run:\nipconfig /flushdns && netsh winsock reset\nThen restart your PC.",
            status: "pending",
            action_type: "command",
            step_order: 2
          };
          inv.candidate_causes[0].probability = 0.88;
          inv.candidate_causes[0].status = "confirmed";
        } else if (inv.category === "Hardware & System") {
          nextAction = {
            id: "a2",
            title: "Restart display driver (Win + Ctrl + Shift + B)",
            description: "Press Win + Ctrl + Shift + B to restart your graphics driver, or disable Hardware Acceleration in your browser settings.",
            status: "pending",
            action_type: "manual",
            step_order: 2
          };
          inv.candidate_causes[0].probability = 0.85;
          inv.candidate_causes[0].status = "confirmed";
        } else {
          nextAction = {
            id: "a2",
            title: "Restart service and clear temporary cache",
            description: "Restart the application and clear cache files to verify clean startup.",
            status: "pending",
            action_type: "manual",
            step_order: 2
          };
        }
      } else if (
        (text && text.toLowerCase().indexOf("resolved") >= 0) ||
        (text && text.toLowerCase().indexOf("yes") >= 0)
      ) {
        replyText = "Excellent! The troubleshooting steps resolved your issue. Your investigation report has been generated.";
        inv.status = "resolved";
        inv.resolved_at = new Date().toISOString();
        qReplies = ["View Full Report", "Save this fix", "Start a new investigation"];
        inv.report = {
          id: "rep_" + id,
          investigation_id: id,
          reference_id: id,
          summary: "Investigation successfully resolved technical issue: " + inv.problem_description,
          root_cause: (inv.candidate_causes[0] && inv.candidate_causes[0].title) || "Resolved via diagnostic sequence",
          resolution_steps: [
            "Identified symptom: " + inv.problem_description,
            "Isolated root cause to " + inv.category,
            "Applied recommended troubleshooting fix"
          ],
          prevention_advice: "Keep drivers and system software updated to prevent similar issues."
        };
      } else {
        replyText = "Understood. Let's perform a secondary isolation step. Please verify whether the issue persists in Safe Mode or with background apps closed.";
        qReplies = ["Yes, problem is resolved now", "Still not working"];
      }

      if (nextAction) {
        inv.recommended_actions = [nextAction];
      }

      inv.messages.push({
        id: "m_reply_" + Date.now(),
        sender: "assistant",
        text: replyText,
        created_at: new Date(Date.now() + 300).toISOString(),
        extra_data: {
          question_id: "q_" + Date.now(),
          quick_replies: qReplies
        }
      });
      inv.updated_at = new Date().toISOString();
      this.save(inv);
      return inv;
    },

    resolve: function (id, userNotes) {
      var inv = this.get(id);
      if (!inv) return null;
      inv.status = "resolved";
      inv.resolved_at = new Date().toISOString();
      inv.report = {
        id: "rep_" + id,
        investigation_id: id,
        reference_id: id,
        summary: "Investigation completed for: " + inv.problem_description,
        root_cause: (inv.candidate_causes[0] && inv.candidate_causes[0].title) || "Resolved",
        resolution_steps: [
          "Symptom diagnosed: " + inv.problem_description,
          "User notes: " + (userNotes || "Confirmed fixed")
        ],
        prevention_advice: "Keep system drivers and components updated."
      };
      this.save(inv);
      return inv;
    }
  };

  var CluezyAPI = {
    STORAGE_KEYS: STORAGE_KEYS,
    SESSION_HEADER: SESSION_HEADER,

    getSupabase: function () {
      return getSupabaseClient();
    },

    setSupabaseClient: function (client) {
      supabaseInstance = client;
    },

    getAuthSession: async function () {
      var client = this.getSupabase();
      if (!client) return null;
      try {
        var res = await client.auth.getSession();
        return (res && res.data && res.data.session) || null;
      } catch (_e) {
        return null;
      }
    },

    getAuthToken: async function () {
      var session = await this.getAuthSession();
      return (session && session.access_token) || null;
    },

    getAuthUser: async function () {
      var session = await this.getAuthSession();
      if (session && session.user) return session.user;
      var client = this.getSupabase();
      if (!client) return null;
      try {
        var res = await client.auth.getUser();
        return (res && res.data && res.data.user) || null;
      } catch (_e) {
        return null;
      }
    },

    isAuthenticated: async function () {
      var token = await this.getAuthToken();
      return !!token;
    },

    signInWithGoogle: async function (redirectPath) {
      var client = this.getSupabase();
      if (!client) {
        throw new Error("Supabase authentication is not loaded. Please verify your connection.");
      }
      var origin = (typeof window !== "undefined" && window.location && window.location.origin) || "";
      var path = redirectPath || (typeof window !== "undefined" && window.location && (window.location.pathname + window.location.search)) || "/investigations/";
      var redirectTo = origin + (path.charAt(0) === "/" ? path : "/" + path);

      var res = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (res && res.error) {
        throw res.error;
      }
      return res && res.data;
    },

    signOut: async function () {
      var client = this.getSupabase();
      if (client) {
        try {
          await client.auth.signOut();
        } catch (_e) {}
      }
    },

    onAuthStateChange: function (callback) {
      var client = this.getSupabase();
      if (!client || typeof callback !== "function") {
        return { data: { subscription: { unsubscribe: function () {} } } };
      }
      try {
        return client.auth.onAuthStateChange(function (event, session) {
          try {
            callback(event, session);
          } catch (err) {
            console.error("Auth state change callback error:", err);
          }
        });
      } catch (_e) {
        return { data: { subscription: { unsubscribe: function () {} } } };
      }
    },

    claimAnonymousInvestigations: async function () {
      var sessionToken = this.getSessionToken();
      if (!sessionToken) return null;
      var authToken = await this.getAuthToken();
      if (!authToken) return null;
      try {
        return await this.request("/investigations/claim-anonymous", {
          method: "POST",
          body: { session_token: sessionToken },
          dedupeKey: "CLAIM_ANON",
        });
      } catch (err) {
        console.warn("Could not claim anonymous investigations:", err);
        return null;
      }
    },

    getBaseUrl: function () {
      return resolveApiBaseUrl();
    },

    getSessionToken: function () {
      return safeStorageGet(STORAGE_KEYS.SESSION_TOKEN);
    },

    setSessionToken: function (token, sessionObj) {
      safeStorageSet(STORAGE_KEYS.SESSION_TOKEN, token);
      if (sessionObj) {
        safeStorageSet(STORAGE_KEYS.SESSION_DATA, JSON.stringify(sessionObj));
      }
    },

    getCachedSessionData: function () {
      var raw = safeStorageGet(STORAGE_KEYS.SESSION_DATA);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (_e) {
        return null;
      }
    },

    clearSession: function () {
      safeStorageSet(STORAGE_KEYS.SESSION_TOKEN, null);
      safeStorageSet(STORAGE_KEYS.SESSION_DATA, null);
    },

    getCurrentInvestigationId: function () {
      if (typeof window !== "undefined" && window.location && window.location.search) {
        var params = new URLSearchParams(window.location.search);
        var qId = params.get("id") || params.get("ref");
        if (qId && qId.trim()) {
          var cleanId = qId.trim().replace(/^#/, "");
          safeStorageSet(STORAGE_KEYS.CURRENT_INV_ID, cleanId);
          return cleanId;
        }
      }
      return safeStorageGet(STORAGE_KEYS.CURRENT_INV_ID);
    },

    setCurrentInvestigationId: function (identifier) {
      var clean = identifier ? String(identifier).trim().replace(/^#/, "") : null;
      safeStorageSet(STORAGE_KEYS.CURRENT_INV_ID, clean);
    },

    getDraftProblem: function () {
      return safeStorageGet(STORAGE_KEYS.DRAFT_PROBLEM) || "";
    },

    setDraftProblem: function (text) {
      safeStorageSet(STORAGE_KEYS.DRAFT_PROBLEM, text || null);
    },

    isMutating: function (key) {
      if (key) return inFlightMutations.has(key);
      return inFlightMutations.size > 0;
    },

    /**
     * Core HTTP request wrapper with timeout, session header injection,
     * automatic 401 session regeneration, and duplicate mutation guard.
     */
    request: async function (path, options) {
      options = options || {};
      var method = (options.method || "GET").toUpperCase();
      var requireSession = options.requireSession !== false;
      var timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
      var dedupeKey = options.dedupeKey || (method !== "GET" ? method + ":" + path : null);

      if (dedupeKey && inFlightMutations.has(dedupeKey)) {
        var dupErr = new Error("A request is already in progress. Please wait.");
        dupErr.code = "DUPLICATE_REQUEST";
        throw dupErr;
      }

      if (dedupeKey) {
        inFlightMutations.add(dedupeKey);
      }

      try {
        var token = this.getSessionToken();
        if (requireSession && !token) {
          var sess = await this.createSession();
          token = sess.session_token;
        }

        var authToken = null;
        try {
          authToken = await this.getAuthToken();
        } catch (_e) {}

        var url = this.getBaseUrl() + (path.charAt(0) === "/" ? path : "/" + path);
        var headers = Object.assign(
          {
            Accept: "application/json",
          },
          options.headers || {}
        );

        if (options.body && !headers["Content-Type"]) {
          headers["Content-Type"] = "application/json";
        }
        if (token) {
          headers[SESSION_HEADER] = token;
        }
        if (authToken) {
          headers["Authorization"] = "Bearer " + authToken;
        }

        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = null;
        if (controller) {
          timer = setTimeout(function () {
            controller.abort();
          }, timeoutMs);
        }

        var fetchOpts = {
          method: method,
          headers: headers,
          body: options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined,
          signal: controller ? controller.signal : undefined,
        };

        var response;
        try {
          response = await fetch(url, fetchOpts);
        } catch (netErr) {
          if (netErr && netErr.name === "AbortError") {
            var timeoutError = new Error("The server took too long to respond. Please retry.");
            timeoutError.code = "REQUEST_TIMEOUT";
            throw timeoutError;
          }
          var connError = new Error("Unable to reach the Cluezy backend server. Ensure the backend is running.");
          connError.code = "NETWORK_ERROR";
          throw connError;
        } finally {
          if (timer) clearTimeout(timer);
        }

        // If 401 Unauthorized
        if (response.status === 401) {
          // If auth token was passed and not yet retried, try refreshing auth token first
          if (authToken && !options._retriedAuth401) {
            try {
              var supabase = this.getSupabase();
              if (supabase && supabase.auth && typeof supabase.auth.refreshSession === "function") {
                var refRes = await supabase.auth.refreshSession();
                if (refRes && refRes.data && refRes.data.session) {
                  if (dedupeKey) inFlightMutations.delete(dedupeKey);
                  return await this.request(
                    path,
                    Object.assign({}, options, { _retriedAuth401: true })
                  );
                }
              }
            } catch (_refErr) {}
          }

          // If anonymous session expired or invalid in DB, automatically re-initialize session once
          if (requireSession && !options._retried401) {
            this.clearSession();
            var freshSession = await this.createSession();
            if (freshSession && freshSession.session_token) {
              if (dedupeKey) inFlightMutations.delete(dedupeKey);
              return await this.request(
                path,
                Object.assign({}, options, { _retried401: true })
              );
            }
          }
        }

        var payload = null;
        try {
          payload = await response.json();
        } catch (_parseErr) {
          payload = null;
        }

        if (!response.ok || (payload && payload.success === false)) {
          var errMsg =
            (payload && payload.error && payload.error.message) ||
            (payload && payload.detail) ||
            (response.status === 503
              ? "Backend service is currently initializing or restarting on Hugging Face. Please retry in a few moments."
              : response.status === 502 || response.status === 504
              ? "Gateway timeout contacting backend server. Please retry."
              : "Request failed with status " + response.status);
          var apiErr = new Error(errMsg);
          apiErr.status = response.status;
          apiErr.code = (payload && payload.error && payload.error.code) || "API_ERROR";
          apiErr.details = payload && payload.error ? payload.error.details : null;
          throw apiErr;
        }

        return payload && payload.data !== undefined ? payload.data : payload;
      } finally {
        if (dedupeKey) {
          inFlightMutations.delete(dedupeKey);
        }
      }
    },

    /**
     * Create a new anonymous session and persist its token in localStorage.
     */
    createSession: async function (userIdentifier) {
      if (sessionInitPromise) {
        return sessionInitPromise;
      }
      var self = this;
      sessionInitPromise = (async function () {
        try {
          var body = userIdentifier ? { user_identifier: userIdentifier } : {};
          var data = await self.request("/sessions", {
            method: "POST",
            body: body,
            requireSession: false,
            dedupeKey: "POST:/sessions",
          });
          if (data && data.session_token) {
            self.setSessionToken(data.session_token, data);
          }
          return data;
        } finally {
          sessionInitPromise = null;
        }
      })();
      return sessionInitPromise;
    },

    /**
     * Ensure an active anonymous session exists, verifying or creating one.
     */
    getOrCreateSession: async function (forceRefresh) {
      var token = this.getSessionToken();
      if (!token) {
        return await this.createSession("Aditi");
      }
      if (!forceRefresh) {
        var cached = this.getCachedSessionData();
        if (cached) return cached;
      }
      try {
        var data = await this.request("/sessions/me", { method: "GET" });
        if (data && data.session_token) {
          this.setSessionToken(data.session_token, data);
        }
        return data;
      } catch (_e) {
        this.clearSession();
        return await this.createSession("Aditi");
      }
    },

    _recordLocalTokenUsage: function (amount) {
      var cached = this.getCachedSessionData();
      if (cached && cached.daily_token_limit) {
        cached.tokens_used = (cached.tokens_used || 0) + amount;
        cached.remaining_tokens = Math.max(0, cached.daily_token_limit - cached.tokens_used);
        cached.remaining_percentage = Math.max(
          0,
          Math.min(100, (cached.remaining_tokens / cached.daily_token_limit) * 100)
        );
        safeStorageSet(STORAGE_KEYS.SESSION_DATA, JSON.stringify(cached));
      }
    },

    /**
     * Create a new troubleshooting investigation from a problem description.
     */
    createInvestigation: async function (problemDescription, meta) {
      meta = meta || {};
      var trimmed = (problemDescription || "").trim();
      if (trimmed.length < 5) {
        var valErr = new Error("Please describe your problem in at least 5 characters.");
        valErr.code = "VALIDATION_ERROR";
        throw valErr;
      }
      var payload = {
        problem_description: trimmed,
        title: meta.title || undefined,
        device_type: meta.device_type || undefined,
        os_info: meta.os_info || undefined,
        network_info: meta.network_info || undefined,
        category: meta.category || undefined,
      };

      try {
        var inv = await this.request("/investigations", {
          method: "POST",
          body: payload,
          dedupeKey: "POST:/investigations",
        });
        if (inv && inv.reference_id) {
          this.setCurrentInvestigationId(inv.reference_id);
        } else if (inv && inv.id) {
          this.setCurrentInvestigationId(inv.id);
        }
        this._recordLocalTokenUsage(600);
        return inv;
      } catch (reqErr) {
        // If backend is sleeping, restarting, or returning 503/network error, seamlessly activate intelligent offline fallback
        if (
          reqErr.status === 503 ||
          reqErr.status === 502 ||
          reqErr.status === 504 ||
          reqErr.code === "NETWORK_ERROR" ||
          reqErr.code === "REQUEST_TIMEOUT" ||
          (reqErr.message && reqErr.message.indexOf("503") >= 0)
        ) {
          console.warn("Backend unavailable (" + (reqErr.message || reqErr.status) + "). Initializing offline fallback diagnostic session.");
          var fallbackInv = OfflineInvestigationEngine.create(trimmed, meta);
          this.setCurrentInvestigationId(fallbackInv.reference_id);
          this._recordLocalTokenUsage(600);
          return fallbackInv;
        }
        throw reqErr;
      }
    },

    /**
     * Retrieve full investigation state (messages, evidence, candidate_causes, recommended_actions, report).
     */
    getInvestigation: async function (identifier) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
      if (!id) {
        var err = new Error("No investigation identifier specified.");
        err.code = "MISSING_IDENTIFIER";
        throw err;
      }
      if (id.indexOf("OFFLINE-") === 0) {
        var localInv = OfflineInvestigationEngine.get(id);
        if (localInv) {
          this.setCurrentInvestigationId(localInv.reference_id);
          return localInv;
        }
      }
      var inv = await this.request("/investigations/" + encodeURIComponent(id), {
        method: "GET",
      });
      if (inv && inv.reference_id) {
        this.setCurrentInvestigationId(inv.reference_id);
      }
      return inv;
    },

    /**
     * Retrieve paginated list of past investigations for the current session.
     */
    listInvestigations: async function (filters) {
      filters = filters || {};
      var params = new URLSearchParams();
      if (filters.status && filters.status !== "all") {
        params.set("status", filters.status);
      }
      if (filters.page) {
        params.set("page", String(filters.page));
      }
      if (filters.page_size) {
        params.set("page_size", String(filters.page_size));
      }
      var qs = params.toString();
      var path = "/investigations" + (qs ? "?" + qs : "");
      try {
        return await this.request(path, { method: "GET" });
      } catch (err) {
        var offlineItems = OfflineInvestigationEngine.list();
        return {
          items: offlineItems,
          total: offlineItems.length,
          page: 1,
          page_size: 50,
          has_more: false,
        };
      }
    },

    /**
     * Submit a custom user chat message during an active investigation.
     */
    submitMessage: async function (identifier, messageText, questionId) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
      var text = (messageText || "").trim();
      if (!text) {
        var err = new Error("Message cannot be empty.");
        err.code = "EMPTY_MESSAGE";
        throw err;
      }
      if (id.indexOf("OFFLINE-") === 0) {
        this._recordLocalTokenUsage(400);
        return OfflineInvestigationEngine.progress(id, text, null, null);
      }
      try {
        var inv = await this.request("/investigations/" + encodeURIComponent(id) + "/progress", {
          method: "POST",
          body: {
            user_message: text,
            question_id: questionId || undefined,
          },
          dedupeKey: "PROGRESS:" + id,
        });
        this._recordLocalTokenUsage(400);
        return inv;
      } catch (pErr) {
        if (pErr.status === 503 || pErr.code === "NETWORK_ERROR") {
          return OfflineInvestigationEngine.progress(id, text, null, null);
        }
        throw pErr;
      }
    },

    /**
     * Submit a quick-reply diagnostic answer option.
     */
    submitDiagnosticAnswer: async function (identifier, questionId, optionValue, userMessage) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
      if (id.indexOf("OFFLINE-") === 0) {
        this._recordLocalTokenUsage(400);
        return OfflineInvestigationEngine.progress(id, userMessage || optionValue, optionValue, null);
      }
      try {
        var inv = await this.request("/investigations/" + encodeURIComponent(id) + "/progress", {
          method: "POST",
          body: {
            question_id: questionId || undefined,
            selected_option_value: optionValue,
            user_message: userMessage || optionValue,
          },
          dedupeKey: "PROGRESS:" + id,
        });
        this._recordLocalTokenUsage(400);
        return inv;
      } catch (pErr) {
        if (pErr.status === 503 || pErr.code === "NETWORK_ERROR") {
          return OfflineInvestigationEngine.progress(id, userMessage || optionValue, optionValue, null);
        }
        throw pErr;
      }
    },

    /**
     * Submit the outcome of testing a recommended solution action ('working', 'not_working', 'need_help').
     */
    submitActionOutcome: async function (identifier, actionId, outcome, userFeedback) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
      if (id.indexOf("OFFLINE-") === 0) {
        this._recordLocalTokenUsage(400);
        return OfflineInvestigationEngine.progress(id, userFeedback, null, outcome);
      }
      try {
        var inv = await this.request("/investigations/" + encodeURIComponent(id) + "/progress", {
          method: "POST",
          body: {
            action_id: actionId || undefined,
            action_outcome: outcome,
            user_message: userFeedback || undefined,
          },
          dedupeKey: "PROGRESS:" + id,
        });
        this._recordLocalTokenUsage(400);
        return inv;
      } catch (pErr) {
        if (pErr.status === 503 || pErr.code === "NETWORK_ERROR") {
          return OfflineInvestigationEngine.progress(id, userFeedback, null, outcome);
        }
        throw pErr;
      }
    },

    /**
     * Explicitly confirm resolution of the investigation and generate the final report.
     */
    confirmResolution: async function (identifier, userNotes) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
      if (id.indexOf("OFFLINE-") === 0) {
        return OfflineInvestigationEngine.resolve(id, userNotes);
      }
      try {
        var inv = await this.request("/investigations/" + encodeURIComponent(id) + "/resolve", {
          method: "POST",
          body: {
            user_notes: userNotes || "User explicitly confirmed issue is resolved.",
          },
          dedupeKey: "RESOLVE:" + id,
        });
        this._recordLocalTokenUsage(400);
        return inv;
      } catch (rErr) {
        if (rErr.status === 503 || rErr.code === "NETWORK_ERROR") {
          return OfflineInvestigationEngine.resolve(id, userNotes);
        }
        throw rErr;
      }
    },

    /**
     * Retrieve the final resolution report for a resolved investigation.
     */
    getReport: async function (identifier) {
      var inv = await this.getInvestigation(identifier);
      return inv ? inv.report : null;
    },

    /**
     * Save a verified fix locally for quick access in Saved Fixes.
     */
    saveFixLocally: function (investigation) {
      if (!investigation) return;
      var raw = safeStorageGet(STORAGE_KEYS.SAVED_FIXES);
      var list = [];
      try {
        list = raw ? JSON.parse(raw) : [];
      } catch (_e) {
        list = [];
      }
      var entry = {
        reference_id: investigation.reference_id,
        title: investigation.title,
        root_cause: investigation.report ? investigation.report.root_cause : "Resolved Issue",
        fix_applied: investigation.report ? investigation.report.fix_applied : "Configuration updated",
        saved_at: new Date().toISOString(),
      };
      list = list.filter(function (item) {
        return item.reference_id !== entry.reference_id;
      });
      list.unshift(entry);
      safeStorageSet(STORAGE_KEYS.SAVED_FIXES, JSON.stringify(list));
      return list;
    },
  };

  return CluezyAPI;
});

