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

  function safeStorageGet(key) {
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
      }
    } catch (_e) {}
    return null;
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
  }

  // Track in-flight mutating requests to prevent duplicate submissions
  var inFlightMutations = new Set();
  var sessionInitPromise = null;

  var CluezyAPI = {
    STORAGE_KEYS: STORAGE_KEYS,
    SESSION_HEADER: SESSION_HEADER,

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

        // If 401 Unauthorized (session expired or invalid in DB), automatically re-initialize session once
        if (response.status === 401 && requireSession && !options._retried401) {
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
            "Request failed with status " + response.status;
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
        return await this.createSession("Parth");
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
        return await this.createSession("Parth");
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
      return await this.request(path, { method: "GET" });
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
    },

    /**
     * Submit a quick-reply diagnostic answer option.
     */
    submitDiagnosticAnswer: async function (identifier, questionId, optionValue, userMessage) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
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
    },

    /**
     * Submit the outcome of testing a recommended solution action ('working', 'not_working', 'need_help').
     */
    submitActionOutcome: async function (identifier, actionId, outcome, userFeedback) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
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
    },

    /**
     * Explicitly confirm resolution of the investigation and generate the final report.
     */
    confirmResolution: async function (identifier, userNotes) {
      var id = (identifier || this.getCurrentInvestigationId() || "").trim().replace(/^#/, "");
      var inv = await this.request("/investigations/" + encodeURIComponent(id) + "/resolve", {
        method: "POST",
        body: {
          user_notes: userNotes || "User explicitly confirmed issue is resolved.",
        },
        dedupeKey: "RESOLVE:" + id,
      });
      this._recordLocalTokenUsage(400);
      return inv;
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

