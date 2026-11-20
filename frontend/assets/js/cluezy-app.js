/**
 * CLUEZY Frontend Application Controller (cluezy-app.js)
 *
 * Connects the existing Framer-exported DOM structure across all Cluezy pages
 * to the FastAPI backend via CluezyAPI while preserving 100% of the visual design.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var API = window.CluezyAPI;
  if (!API) {
    console.error("CluezyAPI must be loaded before cluezy-app.js");
    return;
  }

  // Application runtime state
  var appState = {
    currentInvestigation: null,
    investigationsList: [],
    statusFilter: "all", // 'all' | 'active' | 'resolved'
    searchQuery: "",
    isSubmitting: false,
    isUpdatingDOM: false,
    awaitingExplicitConfirmation: false,
    inlineHelpText: null,
    expandedFullReport: false,
    errorBannerMessage: null,
  };

  /**
   * Format an ISO timestamp into a concise local time string (e.g., "10:25 AM").
   */
  function formatTime(isoString) {
    if (!isoString) return "";
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (_e) {
      return "";
    }
  }

  /**
   * Format an ISO timestamp into a concise date string (e.g., "Nov 19, 2026").
   */
  function formatDate(isoString) {
    if (!isoString) return "";
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (_e) {
      return "";
    }
  }

  /**
   * Format human-readable evidence key and value for "What we know" sidebar.
   */
  function formatEvidenceLabel(ev) {
    var keyMap = {
      ip_reachable: "Direct IP (1.1.1.1)",
      other_devices_working: "Other devices",
      has_valid_ip: "Local IP Lease",
      gateway_ping_success: "Gateway Ping",
      router_wan_down: "Router WAN Light",
      device: "Device",
      issue: "Issue",
      network: "Network",
      os: "OS",
      "operating system": "OS",
    };
    var rawKey = (ev.key || "Fact").trim();
    var displayKey = keyMap[rawKey.toLowerCase()] || rawKey.replace(/_/g, " ");
    var rawVal = String(ev.value !== undefined && ev.value !== null ? ev.value : "");

    var displayVal = rawVal;
    var kLow = rawKey.toLowerCase();
    if (kLow === "ip_reachable") {
      displayVal =
        rawVal === "True"
          ? "Reachable (Opens)"
          : rawVal === "False"
          ? "Unreachable (Timed out)"
          : "Unknown";
    } else if (kLow === "other_devices_working") {
      displayVal =
        rawVal === "True"
          ? "Working normally"
          : rawVal === "False"
          ? "Also offline"
          : "Not tested";
    } else if (kLow === "has_valid_ip") {
      displayVal =
        rawVal === "True"
          ? "Valid Subnet IP (192.168/10.x)"
          : rawVal === "False"
          ? "Invalid APIPA (169.254.x.x)"
          : "Unknown";
    } else if (kLow === "gateway_ping_success") {
      displayVal =
        rawVal === "True"
          ? "Router replies (OK)"
          : rawVal === "False"
          ? "Timed out / Unreachable"
          : "Unknown";
    } else if (kLow === "router_wan_down") {
      displayVal =
        rawVal === "True"
          ? "Red / Error (Signal lost)"
          : rawVal === "False"
          ? "Green / Normal"
          : "Not inspected";
    }
    return displayKey + " · " + displayVal;
  }

  /**
   * Choose an existing inline SVG symbol href for an evidence category.
   */
  function pickEvidenceIconHref(ev) {
    var cat = ((ev && ev.category) || "").toLowerCase();
    var key = ((ev && ev.key) || "").toLowerCase();
    if (cat === "device" || cat === "os" || key.indexOf("device") >= 0 || key.indexOf("os") >= 0) {
      return { cls: "framer-lTDXg framer-a6u4ss", href: "#2455830218" };
    }
    if (cat === "network" || key.indexOf("network") >= 0 || key.indexOf("wifi") >= 0 || key.indexOf("wan") >= 0) {
      return { cls: "framer-AxTtK framer-19trnlj", href: "#1362789546" };
    }
    if (key.indexOf("other") >= 0 || key.indexOf("ip") >= 0 || key.indexOf("gateway") >= 0) {
      return { cls: "framer-PQmMh framer-16v1pv9", href: "#1916995349" };
    }
    return { cls: "framer-gFLMO framer-1ell5i7", href: "#3984941335" };
  }

  /**
   * Inject minimal auxiliary styles for inputs, loading states, and scrollable chat
   * without altering any Framer design tokens or layout styles.
   */
  function ensureHelperStyles() {
    if (document.getElementById("cluezy-helper-styles")) return;
    var style = document.createElement("style");
    style.id = "cluezy-helper-styles";
    style.textContent = [
      ".cluezy-chat-textarea {",
      "  width: 100%;",
      "  min-height: 24px;",
      "  max-height: 150px;",
      "  border: none;",
      "  outline: none;",
      "  background: transparent;",
      "  font-family: 'Inter', 'Inter Placeholder', -apple-system, BlinkMacSystemFont, sans-serif;",
      "  font-size: 13.5px;",
      "  line-height: 1.5;",
      "  color: var(--token-vfjxZCpBY, #17251f);",
      "  resize: none;",
      "  padding: 3px 0;",
      "  margin: 0;",
      "  display: block;",
      "  box-sizing: border-box;",
      "  overflow-y: hidden;",
      "  overflow-x: hidden;",
      "  field-sizing: content;",
      "}",
      ".cluezy-chat-textarea::placeholder {",
      "  color: var(--token-z7x8e0_dE, #58655e);",
      "}",
      "[data-framer-name='Reply composer'] {",
      "  align-items: flex-end !important;",
      "  min-height: 48px !important;",
      "  padding: 10px 14px !important;",
      "  gap: 12px !important;",
      "}",
      "[data-framer-name='Reply composer'] svg[data-framer-name='Paperclip'] {",
      "  margin-bottom: 5px !important;",
      "  flex-shrink: 0 !important;",
      "}",
      "[data-framer-name='Reply composer'] [data-framer-name='Send reply'] {",
      "  margin-bottom: 2px !important;",
      "  flex-shrink: 0 !important;",
      "}",
      "[data-framer-name='Reply composer'] [data-framer-name='Type your reply...'] {",
      "  flex: 1 1 auto !important;",
      "  min-width: 0 !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "}",
      ".cluezy-search-input {",
      "  width: 100%;",
      "  border: none;",
      "  outline: none;",
      "  background: transparent;",
      "  font-family: 'Inter', 'Inter Placeholder', sans-serif;",
      "  font-size: 13px;",
      "  color: var(--token-vfjxZCpBY, #17251f);",
      "  padding: 0;",
      "  margin: 0;",
      "}",
      ".cluezy-hero-input {",
      "  width: 100%;",
      "  border: none;",
      "  outline: none;",
      "  background: transparent;",
      "  font-family: 'Inter', 'Inter Placeholder', sans-serif;",
      "  font-size: 12px;",
      "  color: var(--token-vfjxZCpBY, #17251f);",
      "}",
      /* Prevent website/window vertical scrolling on app workspace pages */
      "html.cluezy-no-page-scroll,",
      "body.cluezy-no-page-scroll {",
      "  height: 100% !important;",
      "  max-height: 100vh !important;",
      "  overflow: hidden !important;",
      "}",
      "body.cluezy-no-page-scroll [data-layout-template='true'] {",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  overflow: hidden !important;",
      "}",
      /* Left sidebar navigation */
      "[data-framer-name='Sidebar'] {",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  overflow-y: auto !important;",
      "  overflow-x: hidden !important;",
      "}",
      /* Main content layout */
      "[data-framer-name='investigation content'],",
      "[data-framer-name='solution content'],",
      "[data-framer-name='resolved content'] {",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  overflow: hidden !important;",
      "  box-sizing: border-box !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "}",
      "[data-framer-name='Conversation and context'] {",
      "  flex: 1 1 0px !important;",
      "  min-height: 0 !important;",
      "  height: 100% !important;",
      "  overflow: hidden !important;",
      "  align-items: stretch !important;",
      "}",
      /* Conversation chat column */
      "[data-framer-name='Conversation'] {",
      "  flex: 1 1 0px !important;",
      "  min-height: 0 !important;",
      "  height: 100% !important;",
      "  max-height: 100% !important;",
      "  overflow-y: auto !important;",
      "  padding-right: 10px !important;",
      "  scroll-behavior: smooth;",
      "}",
      /* Right-hand Investigation context card */
      "[data-framer-name='Investigation context'] {",
      "  width: 290px !important;",
      "  flex: none !important;",
      "  max-height: 100% !important;",
      "  height: fit-content !important;",
      "  overflow-y: auto !important;",
      "  overflow-x: hidden !important;",
      "  background-color: #ffffff !important;",
      "  border: 1px solid var(--token-CrOEkw8uh, #dfe5de) !important;",
      "  border-radius: 14px !important;",
      "  box-sizing: border-box !important;",
      "  padding: 20px !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 16px !important;",
      "}",
      /* Disable Framer pseudo border that detaches and cuts off on scroll */
      "[data-framer-name='Investigation context']::after {",
      "  display: none !important;",
      "}",
      /* Ensure candidate causes stay inside the card cleanly */
      "[data-framer-name='Investigation context'] .framer-15lhbe8,",
      "[data-framer-name='Investigation context'] .framer-1dc4w9q,",
      "[data-framer-name='Investigation context'] .framer-9syjr7 {",
      "  width: 100% !important;",
      "  flex-wrap: nowrap !important;",
      "  align-items: flex-start !important;",
      "  gap: 8px !important;",
      "}",
      "[data-framer-name='Investigation context'] .framer-ku9eke,",
      "[data-framer-name='Investigation context'] .framer-1brbmjb,",
      "[data-framer-name='Investigation context'] .framer-yk78ty {",
      "  flex: 1 1 auto !important;",
      "  min-width: 0 !important;",
      "  word-break: break-word !important;",
      "}",
      /* Sleek custom scrollbars */
      "[data-framer-name='Investigation context']::-webkit-scrollbar,",
      "[data-framer-name='Conversation']::-webkit-scrollbar,",
      "[data-framer-name='Sidebar']::-webkit-scrollbar {",
      "  width: 5px;",
      "}",
      "[data-framer-name='Investigation context']::-webkit-scrollbar-track,",
      "[data-framer-name='Conversation']::-webkit-scrollbar-track,",
      "[data-framer-name='Sidebar']::-webkit-scrollbar-track {",
      "  background: transparent;",
      "}",
      "[data-framer-name='Investigation context']::-webkit-scrollbar-thumb,",
      "[data-framer-name='Conversation']::-webkit-scrollbar-thumb,",
      "[data-framer-name='Sidebar']::-webkit-scrollbar-thumb {",
      "  background: rgba(23, 37, 31, 0.18);",
      "  border-radius: 4px;",
      "}",
      "[data-framer-name='Investigation context']::-webkit-scrollbar-thumb:hover,",
      "[data-framer-name='Conversation']::-webkit-scrollbar-thumb:hover,",
      "[data-framer-name='Sidebar']::-webkit-scrollbar-thumb:hover {",
      "  background: rgba(23, 37, 31, 0.35);",
      "}",
      ".cluezy-disabled {",
      "  opacity: 0.55 !important;",
      "  pointer-events: none !important;",
      "  cursor: not-allowed !important;",
      "}",
      ".cluezy-clickable {",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-cause-note {",
      "  font-family: 'Inter', sans-serif;",
      "  font-size: 11px;",
      "  line-height: 1.4;",
      "  color: var(--token-z7x8e0_dE, #58655e);",
      "  margin-top: 3px;",
      "}",
      ".cluezy-banner-error {",
      "  background-color: #fef2f2;",
      "  border: 1px solid #f87171;",
      "  color: #991b1b;",
      "  padding: 10px 14px;",
      "  border-radius: 8px;",
      "  font-family: 'Inter', sans-serif;",
      "  font-size: 12.5px;",
      "  margin-bottom: 10px;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 10px;",
      "  width: 100%;",
      "}",
      ".cluezy-banner-info {",
      "  background-color: #ecf6e8;",
      "  border: 1px solid #145c38;",
      "  color: #073b27;",
      "  padding: 10px 14px;",
      "  border-radius: 8px;",
      "  font-family: 'Inter', sans-serif;",
      "  font-size: 12.5px;",
      "  margin-top: 8px;",
      "  width: 100%;",
      "}",
      "@keyframes cluezyPulse {",
      "  0%, 100% { opacity: 0.45; }",
      "  50% { opacity: 1; }",
      "}",
      ".cluezy-typing-indicator {",
      "  animation: cluezyPulse 1.4s infinite ease-in-out;",
      "}",
      "/* Quick-reply chip hover: only turn solid green on hover */",
      ".cluezy-quick-reply-btn {",
      "  background-color: rgb(252, 251, 249) !important;",
      "  border: 1px solid var(--token-aW35IeuAs, #145c38) !important;",
      "  border-radius: 9px !important;",
      "  cursor: pointer !important;",
      "  transition: background-color 0.16s ease, color 0.16s ease !important;",
      "}",
      ".cluezy-quick-reply-btn:hover {",
      "  background-color: var(--token-aW35IeuAs, #145c38) !important;",
      "}",
      ".cluezy-quick-reply-btn:hover * {",
      "  color: #ffffff !important;",
      "  --framer-text-color: #ffffff !important;",
      "  --extracted-1w3ko1f: #ffffff !important;",
      "  --extracted-r6o4lv: #ffffff !important;",
      "  --variable-reference-Fq3N0eamG-ezvJGKDD1: #ffffff !important;",
      "}",
      "/* Remove Knowledge Base and Saved Fixes from sidebar navigation */",
      "[data-framer-name='Knowledge Base'], [data-framer-name='Saved Fixes'] {",
      "  display: none !important;",
      "}",
      "/* Sidebar Recent Investigations */",
      ".cluezy-sidebar-recent {",
      "  margin-top: 14px;",
      "  width: 100%;",
      "  padding: 0 4px;",
      "}",
      ".cluezy-recent-header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  padding: 8px 10px;",
      "  cursor: pointer;",
      "  color: #ffffff;",
      "  font-family: 'Inter', sans-serif;",
      "  font-size: 13px;",
      "  font-weight: 600;",
      "  border-radius: 8px;",
      "  transition: background 0.15s ease;",
      "  user-select: none;",
      "}",
      ".cluezy-recent-header:hover {",
      "  background: rgba(255, 255, 255, 0.08);",
      "}",
      ".cluezy-recent-list {",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 2px;",
      "  margin-top: 4px;",
      "}",
      ".cluezy-recent-item {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  padding: 6px 10px;",
      "  border-radius: 6px;",
      "  color: #d1dcd4;",
      "  text-decoration: none;",
      "  font-family: 'Inter', sans-serif;",
      "  font-size: 12px;",
      "  line-height: 1.4;",
      "  transition: background 0.15s ease, color 0.15s ease;",
      "  cursor: pointer;",
      "}",
      ".cluezy-recent-item:hover {",
      "  background: rgba(255, 255, 255, 0.14) !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-recent-item .cluezy-dot {",
      "  color: #22c55e;",
      "  font-size: 8px;",
      "  margin-right: 6px;",
      "  flex-shrink: 0;",
      "}",
      ".cluezy-recent-item .cluezy-title {",
      "  overflow: hidden;",
      "  text-overflow: ellipsis;",
      "  white-space: nowrap;",
      "  max-width: 110px;",
      "}",
      ".cluezy-recent-item .cluezy-time {",
      "  font-size: 11px;",
      "  opacity: 0.7;",
      "  margin-left: 6px;",
      "  flex-shrink: 0;",
      "}",
      "/* My Investigations Category Tabs */",
      ".cluezy-category-tabs {",
      "  display: inline-flex;",
      "  gap: 8px;",
      "  align-items: center;",
      "}",
      ".cluezy-category-tab {",
      "  font-family: 'Inter', sans-serif;",
      "  font-size: 12.5px;",
      "  font-weight: 600;",
      "  padding: 6px 14px;",
      "  border-radius: 8px;",
      "  cursor: pointer;",
      "  border: 1px solid transparent;",
      "  transition: all 0.16s ease;",
      "}",
      ".cluezy-category-tab.active {",
      "  background-color: var(--token-aW35IeuAs, #145c38) !important;",
      "  color: #ffffff !important;",
      "  border-color: var(--token-aW35IeuAs, #145c38) !important;",
      "}",
      ".cluezy-category-tab:not(.active) {",
      "  background-color: rgb(252, 251, 249) !important;",
      "  color: var(--token-vfjxZCpBY, #17251f) !important;",
      "  border: 1px solid var(--token-CrOEkw8uh, #dfe5de) !important;",
      "}",
      ".cluezy-category-tab:not(.active):hover {",
      "  border-color: var(--token-aW35IeuAs, #145c38) !important;",
      "  background-color: #f0f5ee !important;",
      "}",
      "/* Google Sign-in & Profile in Navigation Header */",
      ".cluezy-google-btn {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  gap: 10px !important;",
      "  background-color: #ffffff !important;",
      "  color: #17251f !important;",
      "  border: 1px solid #c2d6ca !important;",
      "  border-radius: 9px !important;",
      "  padding: 10px 18px !important;",
      "  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;",
      "  font-size: 14px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;",
      "  transition: all 0.2s ease !important;",
      "  text-decoration: none !important;",
      "  line-height: 1 !important;",
      "  box-sizing: border-box !important;",
      "}",
      ".cluezy-google-btn:hover {",
      "  background-color: #f6faf7 !important;",
      "  border-color: #145c38 !important;",
      "  color: #145c38 !important;",
      "  box-shadow: 0 2px 8px rgba(20, 92, 56, 0.12) !important;",
      "}",
      ".cluezy-google-btn:active {",
      "  transform: translateY(1px) !important;",
      "}",
      ".cluezy-header-profile-pill {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 9px !important;",
      "  background-color: #ffffff !important;",
      "  border: 1px solid #c2d6ca !important;",
      "  border-radius: 9px !important;",
      "  padding: 6px 14px 6px 8px !important;",
      "  cursor: pointer !important;",
      "  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;",
      "  transition: all 0.2s ease !important;",
      "  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;",
      "  font-size: 13.5px !important;",
      "  font-weight: 600 !important;",
      "  color: #17251f !important;",
      "  user-select: none !important;",
      "}",
      ".cluezy-header-profile-pill:hover {",
      "  border-color: #145c38 !important;",
      "  background-color: #f6faf7 !important;",
      "  box-shadow: 0 2px 8px rgba(20, 92, 56, 0.12) !important;",
      "}",
      ".cluezy-header-avatar {",
      "  width: 28px !important;",
      "  height: 28px !important;",
      "  border-radius: 50% !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  background-color: #e2ede5 !important;",
      "  color: #145c38 !important;",
      "  font-weight: 700 !important;",
      "  font-size: 13px !important;",
      "  flex-shrink: 0 !important;",
      "  overflow: hidden !important;",
      "}",
      ".cluezy-header-avatar img {",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  border-radius: 50% !important;",
      "  object-fit: cover !important;",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  }

  /**
   * Navigate cleanly to an application route with optional query parameters.
   */
  function navigateTo(routePath, queryParams) {
    var cleanRoute = routePath;
    if (cleanRoute !== "/" && !cleanRoute.endsWith("/") && !cleanRoute.endsWith(".html")) {
      cleanRoute = cleanRoute + "/";
    }
    var qs = "";
    if (queryParams) {
      var sp = new URLSearchParams();
      Object.keys(queryParams).forEach(function (k) {
        if (queryParams[k] !== undefined && queryParams[k] !== null) {
          sp.set(k, String(queryParams[k]));
        }
      });
      var s = sp.toString();
      if (s) qs = "?" + s;
    }
    window.location.href = cleanRoute + qs;
  }

  /**
   * Bind a click listener in the capture phase so Framer's SPA link handler does not override it.
   */
  function bindActionClick(el, handler) {
    if (!el) return;
    if (el._cluezyClickHandler) {
      el.removeEventListener("click", el._cluezyClickHandler, true);
    }
    var wrapped = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      if (appState.isSubmitting && !el.hasAttribute("data-allow-while-busy")) {
        return;
      }
      handler(e);
    };
    el._cluezyClickHandler = wrapped;
    el.classList.add("cluezy-clickable");
    el.addEventListener("click", wrapped, true);
  }

  /**
   * Format an ISO timestamp into a concise relative time string (e.g., "2m", "1h", "2d").
   */
  function formatRelativeTime(isoString) {
    if (!isoString) return "";
    try {
      var d = new Date(isoString);
      var diffMs = Date.now() - d.getTime();
      if (diffMs < 0) diffMs = 0;
      var mins = Math.floor(diffMs / (1000 * 60));
      if (mins < 60) return (mins || 1) + "m";
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + "h";
      var days = Math.floor(hours / 24);
      if (days < 7) return days + "d";
      var weeks = Math.floor(days / 7);
      return weeks + "w";
    } catch (_e) {
      return "";
    }
  }

  /**
   * Render the expandable/collapsible Recent Investigations section on the sidebar.
   */
  function renderSidebarRecentInvestigations(items) {
    var sidebars = document.querySelectorAll('[data-framer-name="Sidebar"]');
    if (!sidebars || sidebars.length === 0) return;

    var recentItems = Array.isArray(items) ? items.slice(0, 5) : [];

    sidebars.forEach(function (sidebar) {
      var nav = sidebar.querySelector('[data-framer-name="Workspace navigation"]');
      if (!nav) return;

      var existingRecent = sidebar.querySelector(".cluezy-sidebar-recent");
      if (existingRecent) {
        existingRecent.parentNode.removeChild(existingRecent);
      }

      var recentSection = document.createElement("div");
      recentSection.className = "cluezy-sidebar-recent";

      var header = document.createElement("div");
      header.className = "cluezy-recent-header";
      header.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
        '<span>Recent</span>' +
        '</div>' +
        '<svg class="cluezy-recent-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>';

      var list = document.createElement("div");
      list.className = "cluezy-recent-list";

      header.addEventListener("click", function () {
        var isHidden = list.style.display === "none";
        list.style.display = isHidden ? "flex" : "none";
        var chevron = header.querySelector(".cluezy-recent-chevron");
        if (chevron) {
          chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
        }
      });

      if (recentItems.length === 0) {
        var emptyEl = document.createElement("div");
        emptyEl.style.cssText = "font-size:11px;color:#a3b2a8;padding:6px 10px;font-style:italic;";
        emptyEl.textContent = "No recent investigations";
        list.appendChild(emptyEl);
      } else {
        recentItems.forEach(function (item) {
          var rawTitle = (item.title || item.problem_description || item.reference_id || "Investigation").trim();
          var displayTitle = rawTitle.length > 20 ? rawTitle.slice(0, 18) + "…" : rawTitle;
          var relTime = formatRelativeTime(item.created_at || item.updated_at);

          var a = document.createElement("a");
          a.className = "cluezy-recent-item";
          a.setAttribute("href", "/investigation/?id=" + encodeURIComponent(item.reference_id));
          a.innerHTML =
            '<div style="display:flex;align-items:center;gap:6px;overflow:hidden;">' +
            '<span class="cluezy-dot">●</span>' +
            '<span class="cluezy-title" title="' + rawTitle.replace(/"/g, "&quot;") + '">' + displayTitle + '</span>' +
            '</div>' +
            '<span class="cluezy-time">' + relTime + '</span>';

          bindActionClick(a, function () {
            API.setCurrentInvestigationId(item.reference_id);
            navigateTo("/investigation/", { id: item.reference_id });
          });

          list.appendChild(a);
        });
      }

      recentSection.appendChild(header);
      recentSection.appendChild(list);

      // Append directly after My Investigations or at end of nav
      var myInvAnchor = nav.querySelector('[data-framer-name="My Investigations"]');
      if (myInvAnchor && myInvAnchor.nextSibling) {
        nav.insertBefore(recentSection, myInvAnchor.nextSibling);
      } else {
        nav.appendChild(recentSection);
      }
    });
  }

  /**
   * Update the sidebar token usage display and global sidebar navigation links.
   */
  function bindSidebarAndSessionQuota() {
    var newInvLinks = document.querySelectorAll('[data-framer-name="Sidebar"] [data-framer-name="New Investigation"]');
    newInvLinks.forEach(function (el) {
      var anchor = el.tagName === "A" ? el : el.closest("a");
      if (anchor) {
        bindActionClick(anchor, function () {
          API.setCurrentInvestigationId(null);
          navigateTo("/investigation/", { new: "1" });
        });
      }
    });

    var myInvLinks = document.querySelectorAll('[data-framer-name="Sidebar"] [data-framer-name="My Investigations"]');
    myInvLinks.forEach(function (el) {
      var anchor = el.tagName === "A" ? el : el.closest("a");
      if (anchor) {
        bindActionClick(anchor, function () {
          navigateTo("/investigations/");
        });
      }
    });

    // Remove Knowledge Base and Saved Fixes navigation links from sidebar
    var deprecatedLinks = document.querySelectorAll(
      '[data-framer-name="Sidebar"] [data-framer-name="Knowledge Base"], [data-framer-name="Sidebar"] [data-framer-name="Saved Fixes"]'
    );
    deprecatedLinks.forEach(function (el) {
      var container = el.closest(".framer-u8w30") || el;
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    });

    var brandLinks = document.querySelectorAll('[data-framer-name="Cluezy brand"], [data-framer-name="CLUEZY logo"]');
    brandLinks.forEach(function (el) {
      var anchor = el.tagName === "A" ? el : el.closest("a");
      if (anchor) {
        bindActionClick(anchor, function () {
          navigateTo("/");
        });
      }
    });

    // Fetch and render Recent Investigations in the sidebar (max 5 items)
    API.listInvestigations({ page: 1, page_size: 5 })
      .then(function (res) {
        if (res && Array.isArray(res.items)) {
          renderSidebarRecentInvestigations(res.items);
        }
      })
      .catch(function () {});

    // Update token quota widget
    var sessionData = API.getCachedSessionData();
    if (sessionData) {
      renderTokenQuota(sessionData);
    }
    API.getOrCreateSession(false)
      .then(function (sess) {
        if (sess) renderTokenQuota(sess);
      })
      .catch(function () {});

    // Bind authenticated Google profile or Google Sign-In button
    bindUserProfile();
  }

  function renderTokenQuota(sess) {
    var usageBox = document.querySelector('[data-framer-name="Free plan usage"]');
    if (!usageBox || !sess) return;
    var limitStr = (sess.daily_token_limit || 200000).toLocaleString();
    var pct = sess.remaining_percentage !== undefined ? Math.round(sess.remaining_percentage) : 100;
    var textContainer = usageBox.querySelector(".framer-ff8y6p span, .framer-ff8y6p p");
    if (textContainer) {
      textContainer.textContent = limitStr + " tokens/day · " + pct + "% remaining";
    }
    var bar = usageBox.querySelector('[data-framer-name="Remaining allowance"]');
    if (bar) {
      bar.style.width = Math.max(5, Math.min(100, pct)) + "%";
    }
  }

  /**
   * Bind sidebar user profile container to show Google OAuth avatar, name, and account menu,
   * or a clean "Sign in with Google" button for anonymous visitors.
   */
  async function bindUserProfile() {
    var profileContainers = document.querySelectorAll('[data-framer-name="Profile"]');
    if (!profileContainers || !profileContainers.length) return;

    var user = null;
    try {
      user = await API.getAuthUser();
    } catch (_e) {
      user = null;
    }

    profileContainers.forEach(function (profileEl) {
      // Remove any previously open dropdown
      var oldMenu = document.getElementById("cluezy-account-dropdown");
      if (oldMenu && oldMenu.parentNode) {
        oldMenu.parentNode.removeChild(oldMenu);
      }

      var avatarEl = profileEl.querySelector('[data-framer-name$="avatar"], .framer-1kjjt43');
      var nameEl = profileEl.querySelector('[data-framer-name="Aditi"] span, [data-framer-name="Aditi"] p, .framer-xxjd8o span, .framer-xxjd8o p');
      var planEl = profileEl.querySelector('[data-framer-name="Free Plan"] span, [data-framer-name="Free Plan"] p, .framer-wp9bn7 span, .framer-wp9bn7 p');
      var settingsIcon = profileEl.querySelector('[data-framer-name="Settings"], .framer-19bts9u');

      if (user) {
        // Authenticated user state
        var metadata = user.user_metadata || {};
        var displayName = metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "Aditi");
        var avatarUrl = metadata.avatar_url || metadata.picture || null;
        var email = user.email || "Google Account";

        if (nameEl) {
          nameEl.textContent = displayName;
        }
        if (planEl) {
          planEl.textContent = email;
          planEl.title = email;
          planEl.style.overflow = "hidden";
          planEl.style.textOverflow = "ellipsis";
          planEl.style.whiteSpace = "nowrap";
          planEl.style.maxWidth = "110px";
          planEl.style.display = "block";
        }
        if (avatarEl) {
          if (avatarUrl) {
            avatarEl.innerHTML = '<img src="' + avatarUrl + '" alt="' + displayName + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" referrerpolicy="no-referrer" />';
          } else {
            var initial = (displayName.charAt(0) || "A").toUpperCase();
            avatarEl.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-weight: 700; color: #17251f; font-size: 15px;">' + initial + '</div>';
          }
        }

        profileEl.style.cursor = "pointer";
        profileEl.title = "Account options (Click to view profile or sign out)";
        profileEl.onclick = function (e) {
          e.stopPropagation();
          toggleAccountDropdown(profileEl, user);
        };
      } else {
        // Unauthenticated anonymous state: Show clean Google Sign-In button
        if (nameEl) {
          nameEl.textContent = "Sign In";
        }
        if (planEl) {
          planEl.textContent = "with Google";
        }
        if (avatarEl) {
          avatarEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.8s.7 5.1 1.9 7.5l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.4 7.5 23 12 23z"/></svg>';
        }
        profileEl.style.cursor = "pointer";
        profileEl.title = "Click to sign in with Google";
        profileEl.onclick = function (e) {
          e.stopPropagation();
          API.signInWithGoogle();
        };
      }
    });
  }

  function toggleAccountDropdown(anchorEl, user) {
    var existing = document.getElementById("cluezy-account-dropdown");
    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }

    var rect = anchorEl.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.id = "cluezy-account-dropdown";
    menu.style.cssText =
      "position: fixed; " +
      "left: " + Math.max(12, rect.left) + "px; " +
      "bottom: " + (window.innerHeight - rect.top + 8) + "px; " +
      "width: 230px; " +
      "background-color: #17251f; " +
      "border: 1px solid #326049; " +
      "border-radius: 10px; " +
      "box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); " +
      "z-index: 99999; " +
      "padding: 12px; " +
      "color: #e5ece7; " +
      "font-family: Inter, sans-serif;";

    var metadata = (user && user.user_metadata) || {};
    var displayName = metadata.full_name || metadata.name || (user && user.email ? user.email.split("@")[0] : "Aditi");
    var email = (user && user.email) || "";

    menu.innerHTML =
      '<div style="margin-bottom: 10px; border-bottom: 1px solid #326049; padding-bottom: 8px;">' +
      '  <div style="font-weight: 600; font-size: 14px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(displayName) + '</div>' +
      '  <div style="font-size: 12px; color: #9bb5a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(email) + '</div>' +
      '</div>' +
      '<button id="cluezy-logout-btn" style="width: 100%; background: rgba(220, 53, 69, 0.15); border: 1px solid rgba(220, 53, 69, 0.4); color: #ff8b8b; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background 0.15s;">' +
      '  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
      '  Sign Out' +
      '</button>';

    document.body.appendChild(menu);

    var logoutBtn = menu.querySelector("#cluezy-logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = async function () {
        logoutBtn.disabled = true;
        logoutBtn.textContent = "Signing out...";
        try {
          await API.signOut();
        } catch (_e) {}
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        bindUserProfile();
        // Refresh sidebar investigations
        API.listInvestigations({ page: 1, page_size: 5 })
          .then(function (res) {
            if (res && Array.isArray(res.items)) {
              renderSidebarRecentInvestigations(res.items);
            }
          })
          .catch(function () {});
      };
    }

    function onDocClick(e) {
      if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener("click", onDocClick);
      }
    }
    setTimeout(function () {
      document.addEventListener("click", onDocClick);
    }, 10);
  }

  /**
   * Bind Google authentication button or profile menu in landing page navigation header
   */
  async function bindLandingHeaderAuth() {
    var container = document.getElementById("cluezy-header-auth-container");
    if (!container) {
      var actEl = document.querySelector('[data-framer-name="Account actions"]');
      if (actEl) {
        container = actEl.querySelector("#cluezy-header-auth-container") || actEl;
      }
    }
    if (!container) return;

    var user = null;
    try {
      user = await API.getAuthUser();
    } catch (_e) {
      user = null;
    }

    // Remove any currently open header dropdown
    var oldMenu = document.getElementById("cluezy-header-account-dropdown");
    if (oldMenu && oldMenu.parentNode) oldMenu.parentNode.removeChild(oldMenu);

    if (user) {
      var metadata = user.user_metadata || {};
      var displayName = metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "Account");
      var avatarUrl = metadata.avatar_url || metadata.picture || null;
      var email = user.email || "";

      var avatarHtml = avatarUrl
        ? '<img src="' + avatarUrl + '" alt="' + escapeHtml(displayName) + '" referrerpolicy="no-referrer" />'
        : '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-weight:700;color:#145c38;font-size:13px;">' + (displayName.charAt(0) || "U").toUpperCase() + '</div>';

      container.innerHTML =
        '<div class="cluezy-header-profile-pill" id="cluezy-header-profile-btn" role="button" tabindex="0" title="Account menu">' +
        '  <div class="cluezy-header-avatar">' + avatarHtml + '</div>' +
        '  <span class="cluezy-header-name">' + escapeHtml(displayName) + '</span>' +
        '  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:#58655e;margin-left:2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
        '</div>';

      var profileBtn = container.querySelector("#cluezy-header-profile-btn");
      if (profileBtn) {
        profileBtn.onclick = function (e) {
          e.stopPropagation();
          toggleLandingHeaderDropdown(profileBtn, user);
        };
        profileBtn.onkeydown = function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleLandingHeaderDropdown(profileBtn, user);
          }
        };
      }
    } else {
      container.innerHTML =
        '<button type="button" id="cluezy-header-google-btn" class="cluezy-google-btn" title="Sign in with Google">' +
        '  <svg class="cluezy-google-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0;">' +
        '    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>' +
        '    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>' +
        '    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>' +
        '    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>' +
        '  </svg>' +
        '  <span class="cluezy-google-btn-text">Sign in with Google</span>' +
        '</button>';

      var googleBtn = container.querySelector("#cluezy-header-google-btn");
      if (googleBtn) {
        googleBtn.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          googleBtn.disabled = true;
          var textSpan = googleBtn.querySelector(".cluezy-google-btn-text");
          if (textSpan) textSpan.textContent = "Connecting...";
          API.signInWithGoogle("/investigation/");
        };
      }
    }
  }

  function toggleLandingHeaderDropdown(anchorEl, user) {
    var existing = document.getElementById("cluezy-header-account-dropdown");
    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }

    var rect = anchorEl.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.id = "cluezy-header-account-dropdown";
    menu.style.cssText =
      "position: fixed; " +
      "right: " + Math.max(16, window.innerWidth - rect.right) + "px; " +
      "top: " + (rect.bottom + 8) + "px; " +
      "width: 240px; " +
      "background-color: #17251f; " +
      "border: 1px solid #326049; " +
      "border-radius: 10px; " +
      "box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); " +
      "z-index: 999999; " +
      "padding: 12px; " +
      "color: #e5ece7; " +
      "font-family: 'Inter', -apple-system, sans-serif;";

    var metadata = (user && user.user_metadata) || {};
    var displayName = metadata.full_name || metadata.name || (user && user.email ? user.email.split("@")[0] : "Account");
    var email = (user && user.email) || "";

    menu.innerHTML =
      '<div style="margin-bottom: 10px; border-bottom: 1px solid #326049; padding-bottom: 8px;">' +
      '  <div style="font-weight: 600; font-size: 14px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(displayName) + '</div>' +
      '  <div style="font-size: 12px; color: #9bb5a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(email) + '</div>' +
      '</div>' +
      '<div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">' +
      '  <a href="/investigation/" style="display: flex; align-items: center; gap: 8px; color: #e5ece7; font-size: 13px; text-decoration: none; padding: 7px 8px; border-radius: 6px; transition: background 0.15s;" onmouseover="this.style.background=\'rgba(255,255,255,0.08)\'" onmouseout="this.style.background=\'transparent\'">' +
      '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
      '    New Investigation' +
      '  </a>' +
      '  <a href="/investigations/" style="display: flex; align-items: center; gap: 8px; color: #e5ece7; font-size: 13px; text-decoration: none; padding: 7px 8px; border-radius: 6px; transition: background 0.15s;" onmouseover="this.style.background=\'rgba(255,255,255,0.08)\'" onmouseout="this.style.background=\'transparent\'">' +
      '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>' +
      '    My Investigations' +
      '  </a>' +
      '</div>' +
      '<button id="cluezy-header-logout-btn" style="width: 100%; background: rgba(220, 53, 69, 0.15); border: 1px solid rgba(220, 53, 69, 0.4); color: #ff8b8b; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background 0.15s;">' +
      '  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
      '  Sign Out' +
      '</button>';

    document.body.appendChild(menu);

    var logoutBtn = menu.querySelector("#cluezy-header-logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = async function () {
        logoutBtn.disabled = true;
        logoutBtn.textContent = "Signing out...";
        try {
          await API.signOut();
        } catch (_e) {}
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        bindLandingHeaderAuth();
      };
    }

    function onDocClick(e) {
      if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        document.removeEventListener("click", onDocClick);
      }
    }
    setTimeout(function () {
      document.addEventListener("click", onDocClick);
    }, 10);
  }

  // ============================================================================
  // 1. LANDING PAGE CONTROLLER (/index.html)
  // ============================================================================
  function mountLandingPage(heroEl) {
    if (!heroEl) return;
    appState.isUpdatingDOM = true;
    try {
      heroEl.setAttribute("data-cluezy-rendered", "true");

      // Make the laptop prompt interactive so users can type directly or click Start Troubleshooting
      var promptContainer = heroEl.querySelector('[data-framer-name="Laptop prompt"]');
      var promptTextBox = heroEl.querySelector('[data-framer-name="My laptop is very slow..."]');
      var promptSendIcon = promptContainer ? promptContainer.querySelector('[data-framer-name="Send"]') : null;

      if (promptTextBox && !promptTextBox.querySelector("input")) {
        promptTextBox.innerHTML = "";
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "cluezy-hero-input";
        inp.placeholder = "Describe your issue (e.g. Wi-Fi connected, no internet)...";
        inp.setAttribute("aria-label", "Describe your technical issue");
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && inp.value.trim()) {
            e.preventDefault();
            API.setDraftProblem(inp.value.trim());
            API.setCurrentInvestigationId(null);
            navigateTo("/investigation/", { new: "1" });
          }
        });
        promptTextBox.appendChild(inp);

        if (promptSendIcon) {
          bindActionClick(promptSendIcon, function () {
            if (inp.value.trim()) {
              API.setDraftProblem(inp.value.trim());
            }
            API.setCurrentInvestigationId(null);
            navigateTo("/investigation/", { new: "1" });
          });
        }
      }

      // Bind "Start Troubleshooting" button in hero
      var startBtns = document.querySelectorAll(
        '[data-framer-name="Start Troubleshooting"] a, [data-framer-name="Start Troubleshooting"]'
      );
      startBtns.forEach(function (btn) {
        var a = btn.tagName === "A" ? btn : (btn.querySelector("a") || btn);
        bindActionClick(a, function () {
          var heroInp = document.querySelector(".cluezy-hero-input");
          if (heroInp && heroInp.value.trim()) {
            API.setDraftProblem(heroInp.value.trim());
          }
          API.setCurrentInvestigationId(null);
          navigateTo("/investigation/", { new: "1" });
        });
      });

      // Bind Google Sign-in button or authenticated profile pill in header
      bindLandingHeaderAuth();

      // Bind "See How It Works" -> scrolls to Features or opens Knowledge Base
      var howBtns = document.querySelectorAll('[data-framer-name="See How It Works"] a');
      howBtns.forEach(function (a) {
        bindActionClick(a, function () {
          var feat = document.querySelector('[data-framer-name="Features"]');
          if (feat && typeof feat.scrollIntoView === "function") {
            feat.scrollIntoView({ behavior: "smooth" });
          } else {
            navigateTo("/knowledge-base/");
          }
        });
      });
    } finally {
      appState.isUpdatingDOM = false;
    }
  }

  // ============================================================================
  // 2. INVESTIGATION CHAT PAGE CONTROLLER (/investigation/index.html)
  // ============================================================================
  function createChatBubbleDOM(sender, contentText, timestampText) {
    if (sender === "user") {
      var userCard = document.createElement("div");
      userCard.className = "framer-vu1os6";
      userCard.setAttribute("data-border", "true");
      userCard.setAttribute("data-framer-name", "Your issue");

      var textWrap = document.createElement("div");
      textWrap.className = "framer-nzm9lm";
      textWrap.setAttribute("data-framer-component-type", "RichTextContainer");
      textWrap.style.transform = "none";

      var p = document.createElement("p");
      p.className = "framer-text framer-styles-preset-g5gvkz";
      p.setAttribute("data-styles-preset", "HNZA9_QSM");
      p.setAttribute("dir", "auto");
      p.textContent = contentText;
      textWrap.appendChild(p);
      userCard.appendChild(textWrap);

      if (timestampText) {
        var timeWrap = document.createElement("div");
        timeWrap.className = "framer-vl9599";
        timeWrap.setAttribute("data-framer-component-type", "RichTextContainer");
        timeWrap.style.transform = "none";
        var tp = document.createElement("p");
        tp.className = "framer-text framer-styles-preset-150qgy0";
        tp.setAttribute("data-styles-preset", "LwAm2Brje");
        tp.setAttribute("dir", "auto");
        tp.style.setProperty("--framer-text-alignment", "right");
        tp.textContent = timestampText;
        timeWrap.appendChild(tp);
        userCard.appendChild(timeWrap);
      }
      return userCard;
    } else {
      var botCard = document.createElement("div");
      botCard.className = "framer-wvffk8";
      botCard.setAttribute("data-border", "true");
      botCard.setAttribute("data-framer-name", "Cluezy response");

      var paragraphs = String(contentText || "")
        .split(/\n\n+/)
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);

      if (paragraphs.length === 0) {
        paragraphs = [String(contentText || "")];
      }

      paragraphs.forEach(function (para, idx) {
        var pWrap = document.createElement("div");
        pWrap.className = idx === 0 ? "framer-ekz3f" : "framer-11kt4mn";
        pWrap.setAttribute("data-framer-component-type", "RichTextContainer");
        pWrap.style.transform = "none";

        var lines = para.split("\n");
        lines.forEach(function (line, lineIdx) {
          var p = document.createElement("p");
          p.className = "framer-text framer-styles-preset-g5gvkz";
          p.setAttribute("data-styles-preset", "HNZA9_QSM");
          p.setAttribute("dir", "auto");
          if (lineIdx > 0) {
            p.style.marginTop = "4px";
          }
          // Render bold segments (**text**) safely via textNodes & <strong>
          appendFormattedTextSafely(p, line);
          pWrap.appendChild(p);
        });

        botCard.appendChild(pWrap);
      });

      if (timestampText) {
        var bTimeWrap = document.createElement("div");
        bTimeWrap.className = "framer-1t5lc6m";
        bTimeWrap.setAttribute("data-framer-component-type", "RichTextContainer");
        bTimeWrap.style.transform = "none";
        var btp = document.createElement("p");
        btp.className = "framer-text framer-styles-preset-150qgy0";
        btp.setAttribute("data-styles-preset", "LwAm2Brje");
        btp.setAttribute("dir", "auto");
        btp.style.setProperty("--framer-text-alignment", "right");
        btp.textContent = timestampText;
        bTimeWrap.appendChild(btp);
        botCard.appendChild(bTimeWrap);
      }
      return botCard;
    }
  }

  /**
   * Safely render text containing **bold** markers without using innerHTML with user strings.
   */
  function appendFormattedTextSafely(parentEl, text) {
    var str = String(text || "");
    var parts = str.split(/(\*\*[^*]+\*\*)/g);
    parts.forEach(function (part) {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        var strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parentEl.appendChild(strong);
      } else if (part) {
        parentEl.appendChild(document.createTextNode(part));
      }
    });
  }

  /**
   * Create a Framer-styled quick-reply button chip.
   */
  function createQuickReplyButtonDOM(label, isPrimary, onClick) {
    var container = document.createElement("div");
    container.className = isPrimary ? "framer-1v8wo4k-container" : "framer-zqgly1-container";
    container.setAttribute("data-framer-name", label);

    var a = document.createElement("a");
    a.className = "framer-6VCSX framer-ntMaH framer-9jeig7 framer-v-9jeig7 framer-tkxn9d cluezy-quick-reply-btn";
    a.setAttribute("data-border", "true");
    a.setAttribute("data-framer-name", "Default");
    a.setAttribute("href", "javascript:void(0)");
    a.setAttribute("role", "button");
    a.style.cssText =
      "--border-bottom-width: 1px; --border-color: var(--token-aW35IeuAs); --border-left-width: 1px; " +
      "--border-right-width: 1px; --border-style: solid; --border-top-width: 1px; border-radius: 9px; opacity: 1; " +
      (isPrimary ? "background-color: rgb(20, 92, 56);" : "background-color: rgb(252, 251, 249);") +
      "cursor: pointer;";

    var labelDiv = document.createElement("div");
    labelDiv.className = "framer-182kob9";
    labelDiv.setAttribute("data-framer-component-type", "RichTextContainer");
    labelDiv.setAttribute("data-framer-name", "Label");
    var textColor = isPrimary ? "rgb(255, 255, 255)" : "rgb(23, 37, 31)";
    labelDiv.style.cssText =
      "--extracted-1w3ko1f: " +
      textColor +
      "; --extracted-r6o4lv: " +
      textColor +
      "; --variable-reference-Fq3N0eamG-ezvJGKDD1: " +
      textColor +
      "; transform: none; opacity: 1;";

    var p = document.createElement("p");
    p.className = "framer-text framer-styles-preset-1hewirz";
    p.setAttribute("data-styles-preset", "Z1BYkLRW1");
    p.setAttribute("dir", "auto");
    p.style.setProperty("--framer-text-color", textColor);

    var span = document.createElement("span");
    span.className = "framer-text";
    span.style.setProperty("--framer-text-color", textColor);
    span.textContent = label;

    p.appendChild(span);
    labelDiv.appendChild(p);
    a.appendChild(labelDiv);
    container.appendChild(a);

    // Hover effect: only turn solid green on hover
    if (!isPrimary) {
      a.addEventListener("mouseenter", function () {
        a.style.backgroundColor = "rgb(20, 92, 56)";
        span.style.setProperty("--framer-text-color", "rgb(255, 255, 255)");
        p.style.setProperty("--framer-text-color", "rgb(255, 255, 255)");
        span.style.color = "rgb(255, 255, 255)";
      });
      a.addEventListener("mouseleave", function () {
        a.style.backgroundColor = "rgb(252, 251, 249)";
        span.style.setProperty("--framer-text-color", "rgb(23, 37, 31)");
        p.style.setProperty("--framer-text-color", "rgb(23, 37, 31)");
        span.style.color = "rgb(23, 37, 31)";
      });
    }

    if (appState.isSubmitting) {
      a.classList.add("cluezy-disabled");
    }

    bindActionClick(a, onClick);
    return container;
  }

  /**
   * Render the Investigation Page DOM based on `appState.currentInvestigation`.
   */
  function renderInvestigationView() {
    var root = document.querySelector('[data-framer-name="investigation content"]');
    if (!root) return;

    appState.isUpdatingDOM = true;
    try {
      root.setAttribute("data-cluezy-rendered", "true");
      var inv = appState.currentInvestigation;

      // 1. Update Heading & Status Badge
      var headingH2 = root.querySelector('[data-framer-name="Investigation heading"] h2');
      var statusSpan = root.querySelector(
        '[data-framer-name="Status Active"] span, [data-framer-name="Status Active"] p'
      );

      if (inv) {
        if (headingH2) {
          headingH2.textContent = "Investigation  #" + inv.reference_id;
        }
        if (statusSpan) {
          var statusMap = {
            active: "Active",
            in_progress: "In Progress",
            testing_solution: "Testing Fix",
            resolved: "Resolved",
          };
          statusSpan.textContent = statusMap[inv.status] || "Active";
        }
      } else {
        if (headingH2) {
          headingH2.textContent = "New Investigation";
        }
        if (statusSpan) {
          statusSpan.textContent = "Ready";
        }
      }

      // 2. Ensure Reply Composer has an interactive <textarea>
      var composer = root.querySelector('[data-framer-name="Reply composer"]');
      var replyBox = composer ? composer.querySelector('[data-framer-name="Type your reply..."]') : null;
      var sendBtn = composer ? composer.querySelector('[data-framer-name="Send reply"]') : null;
      var textarea = replyBox ? replyBox.querySelector("textarea.cluezy-chat-textarea") : null;

      if (replyBox && !textarea) {
        replyBox.innerHTML = "";
        textarea = document.createElement("textarea");
        textarea.className = "cluezy-chat-textarea";
        textarea.rows = 1;
        textarea.placeholder = inv
          ? "Type your reply or test result (Enter to send, Shift+Enter for newline)…"
          : "Describe your technical issue in detail (e.g., Wi-Fi connected on Windows laptop, websites won't open)…";
        textarea.setAttribute("aria-label", "Message input");

        textarea.addEventListener("input", function () {
          autoResizeChatTextarea(textarea);
        });

        textarea.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleComposerSubmit(textarea);
          }
        });
        replyBox.appendChild(textarea);
        autoResizeChatTextarea(textarea);
      } else if (textarea) {
        textarea.placeholder = inv
          ? "Type your reply or test result (Enter to send, Shift+Enter for newline)…"
          : "Describe your technical issue in detail (e.g., Wi-Fi connected on Windows laptop, websites won't open)…";
        textarea.disabled = appState.isSubmitting;
        autoResizeChatTextarea(textarea);
      }

      if (sendBtn) {
        sendBtn.removeAttribute("href");
        sendBtn.setAttribute("href", "javascript:void(0)");
        sendBtn.setAttribute("role", "button");
        if (appState.isSubmitting) {
          sendBtn.classList.add("cluezy-disabled");
        } else {
          sendBtn.classList.remove("cluezy-disabled");
        }
        bindActionClick(sendBtn, function (e) {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          var currentTa = replyBox ? replyBox.querySelector("textarea.cluezy-chat-textarea") : textarea;
          if (currentTa) handleComposerSubmit(currentTa);
        });
      }

      // 3. Render Conversation Messages, Answers & Composer inside [data-framer-name="Conversation"]
      var convContainer = root.querySelector('[data-framer-name="Conversation"]');
      if (convContainer) {
        var answersContainer = convContainer.querySelector('[data-framer-name="Diagnostic answers"]');
        if (!answersContainer) {
          answersContainer = document.createElement("div");
          answersContainer.className = "framer-e0rgel";
          answersContainer.setAttribute("data-framer-name", "Diagnostic answers");
        }

        // Remove old message bubbles and banners while preserving answersContainer & composer
        Array.from(convContainer.children).forEach(function (child) {
          if (child !== answersContainer && child !== composer) {
            convContainer.removeChild(child);
          }
        });

        // Optional error banner if last request failed
        var anchorBefore = answersContainer.parentNode === convContainer ? answersContainer : composer;
        if (appState.errorBannerMessage) {
          var errBanner = document.createElement("div");
          errBanner.className = "cluezy-banner-error";
          var errSpan = document.createElement("span");
          errSpan.textContent = appState.errorBannerMessage;
          var dismissBtn = document.createElement("button");
          dismissBtn.textContent = "Dismiss";
          dismissBtn.style.cssText =
            "border:1px solid #991b1b;background:transparent;color:#991b1b;border-radius:5px;padding:2px 8px;cursor:pointer;font-size:11px;";
          dismissBtn.addEventListener("click", function () {
            appState.errorBannerMessage = null;
            renderInvestigationView();
          });
          errBanner.appendChild(errSpan);
          errBanner.appendChild(dismissBtn);
          convContainer.insertBefore(errBanner, anchorBefore);
        }

        if (inv && Array.isArray(inv.messages) && inv.messages.length > 0) {
          inv.messages.forEach(function (msg) {
            var bubble = createChatBubbleDOM(msg.sender, msg.content, formatTime(msg.created_at));
            convContainer.insertBefore(bubble, anchorBefore);
          });
        } else if (!inv && !appState.isSubmitting) {
          // Empty / New Investigation Welcome State
          var welcomeCard = createChatBubbleDOM(
            "assistant",
            "Welcome to Cluezy! Describe any technical issue below (or click one of the common scenarios) to start a structured, evidence-based investigation.",
            "Now"
          );
          convContainer.insertBefore(welcomeCard, anchorBefore);
        }

        if (appState.isSubmitting) {
          var loadingBubble = createChatBubbleDOM(
            "assistant",
            "Analyzing evidence and evaluating diagnostic rules…",
            "Working…"
          );
          loadingBubble.classList.add("cluezy-typing-indicator");
          convContainer.insertBefore(loadingBubble, anchorBefore);
        }

        // Populate quick-reply buttons
        answersContainer.innerHTML = "";
        if (!inv) {
          var starterPrompts = [
            {
              label: "Wi-Fi connected, websites not opening (phone works)",
              prompt:
                "My Windows laptop is connected to Wi-Fi but websites aren't opening, though my phone works fine on the same network.",
            },
            {
              label: "All devices on Wi-Fi have no internet",
              prompt:
                "My laptop is connected to Wi-Fi with no internet, and no other devices or phones on the Wi-Fi can open websites either.",
            },
            {
              label: "Wi-Fi says No Internet (IP starts with 169.254)",
              prompt:
                "My Windows laptop is connected to Wi-Fi with no internet access. I ran ipconfig and my IPv4 address starts with 169.254.",
            },
          ];
          starterPrompts.forEach(function (sp) {
            var btn = createQuickReplyButtonDOM(sp.label, false, function () {
              startNewInvestigation(sp.prompt);
            });
            answersContainer.appendChild(btn);
          });
        } else {
          // Determine suggested responses from the latest assistant message
          var lastAssistantMsg = null;
          for (var i = inv.messages.length - 1; i >= 0; i--) {
            if (inv.messages[i].sender === "assistant") {
              lastAssistantMsg = inv.messages[i];
              break;
            }
          }
          var suggestions =
            lastAssistantMsg && Array.isArray(lastAssistantMsg.suggested_responses)
              ? lastAssistantMsg.suggested_responses
              : [];
          var qId =
            lastAssistantMsg && lastAssistantMsg.extra_data
              ? lastAssistantMsg.extra_data.question_id
              : null;

          suggestions.forEach(function (label) {
            var chip = createQuickReplyButtonDOM(label, false, function () {
              handleQuickReplyClick(inv, label, qId);
            });
            answersContainer.appendChild(chip);
          });
        }

        if (answersContainer.parentNode !== convContainer) {
          convContainer.insertBefore(answersContainer, composer);
        }

        // Auto-scroll conversation to bottom
        convContainer.scrollTop = convContainer.scrollHeight;
      }

      // 4. Render Sidebar Context ("What we know", "Possible causes", "Next step")
      renderDiagnosticSidebar(root, inv);
    } finally {
      appState.isUpdatingDOM = false;
    }
  }

  /**
   * Render the right-hand Investigation Context sidebar.
   */
  function renderDiagnosticSidebar(root, inv) {
    var sidebar = root.querySelector('[data-framer-name="Investigation context"]');
    if (!sidebar) return;

    var whatWeKnowHeader = sidebar.querySelector('[data-framer-name="What we know"]');
    var possibleCausesHeader = sidebar.querySelector('[data-framer-name="Possible causes"]');
    var nextStepHeader = sidebar.querySelector('[data-framer-name="Next step"]');
    var nextCheckLink = sidebar.querySelector('[data-framer-name="Next check"]');

    if (!whatWeKnowHeader || !possibleCausesHeader || !nextStepHeader) return;

    // Remove existing dynamic or static items between headers
    var toRemove = [];
    var children = Array.from(sidebar.children);
    var keepSet = new Set([
      sidebar.querySelector('[data-framer-name="Investigation Context"]'),
      whatWeKnowHeader,
      possibleCausesHeader,
      nextStepHeader,
      nextCheckLink,
    ]);
    children.forEach(function (ch) {
      if (!keepSet.has(ch)) {
        toRemove.push(ch);
      }
    });
    toRemove.forEach(function (ch) {
      sidebar.removeChild(ch);
    });

    // A. Populate "What we know" Evidence Items before possibleCausesHeader
    var evidenceItems = inv && Array.isArray(inv.evidence) ? inv.evidence : [];
    if (evidenceItems.length === 0) {
      var emptyEv = createEvidenceRowDOM({
        category: "issue",
        key: "Status",
        value: "Awaiting problem description",
      });
      sidebar.insertBefore(emptyEv, possibleCausesHeader);
    } else {
      evidenceItems.forEach(function (ev) {
        var row = createEvidenceRowDOM(ev);
        sidebar.insertBefore(row, possibleCausesHeader);
      });
    }

    // B. Populate "Possible causes" Items before nextStepHeader
    var causes = inv && Array.isArray(inv.candidate_causes) ? inv.candidate_causes.slice() : [];
    causes.sort(function (a, b) {
      var rank = function (c) {
        if (c.status === "confirmed") return 2;
        if (c.status === "ruled_out") return -1;
        return 1;
      };
      var rDiff = rank(b) - rank(a);
      if (rDiff !== 0) return rDiff;
      return (b.confidence_score || 0) - (a.confidence_score || 0);
    });

    if (causes.length === 0) {
      var emptyCause = createCandidateCauseRowDOM({
        title: "Pending initial symptom analysis",
        likelihood: "Low",
        status: "suspected",
        notes: "Describe your issue to evaluate candidate causes.",
      });
      sidebar.insertBefore(emptyCause, nextStepHeader);
    } else {
      causes.forEach(function (cause) {
        var cRow = createCandidateCauseRowDOM(cause);
        sidebar.insertBefore(cRow, nextStepHeader);
      });
    }

    // C. Populate "Next step" & Investigation Progress stage
    var nextStepTitleP = nextStepHeader.querySelector("p");
    if (nextStepTitleP) {
      if (!inv) {
        nextStepTitleP.textContent = "Next step · Stage 1: Describe Issue";
      } else if (inv.status === "resolved") {
        nextStepTitleP.textContent = "Next step · Resolved (Report Ready)";
      } else if (inv.status === "testing_solution") {
        nextStepTitleP.textContent = "Next step · Testing Recommended Fix";
      } else {
        nextStepTitleP.textContent = "Next step · Isolating Root Cause";
      }
    }

    if (nextCheckLink) {
      var nextTextSpan = nextCheckLink.querySelector("span, p");
      if (!inv) {
        if (nextTextSpan) nextTextSpan.textContent = "Enter your problem description in chat";
        bindActionClick(nextCheckLink, function () {
          var ta = document.querySelector(".cluezy-chat-textarea");
          if (ta) ta.focus();
        });
      } else if (inv.status === "resolved") {
        if (nextTextSpan) nextTextSpan.textContent = "View Final Resolution Report (#" + inv.reference_id + ")";
        bindActionClick(nextCheckLink, function () {
          navigateTo("/resolved/", { id: inv.reference_id });
        });
      } else {
        var actions = Array.isArray(inv.recommended_actions) ? inv.recommended_actions : [];
        var pendingAct =
          actions.filter(function (a) {
            return a.status === "pending";
          }).pop() || actions[actions.length - 1];
        var nextTitle = pendingAct ? pendingAct.title : "Open Solution Walkthrough";
        if (nextTextSpan) nextTextSpan.textContent = nextTitle;
        bindActionClick(nextCheckLink, function () {
          navigateTo("/solution/", { id: inv.reference_id });
        });
      }
    }
  }

  function createEvidenceRowDOM(ev) {
    var row = document.createElement("div");
    row.className = "framer-1sacewz";
    row.setAttribute("data-framer-name", ev.key || "Evidence");
    row.style.width = "100%";
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.gap = "8px";

    var iconSpec = pickEvidenceIconHref(ev);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", iconSpec.cls);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("role", "presentation");
    svg.style.flexShrink = "0";
    svg.style.marginTop = "2px";
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", iconSpec.href);
    svg.appendChild(use);
    row.appendChild(svg);

    var textDiv = document.createElement("div");
    textDiv.className = "framer-1wzs70";
    textDiv.setAttribute("data-framer-component-type", "RichTextContainer");
    textDiv.style.transform = "none";
    textDiv.style.flex = "1 1 auto";
    textDiv.style.minWidth = "0";
    textDiv.style.wordBreak = "break-word";

    var p = document.createElement("p");
    p.className = "framer-text framer-styles-preset-150qgy0";
    p.setAttribute("data-styles-preset", "LwAm2Brje");
    p.setAttribute("dir", "auto");
    p.style.setProperty("--framer-text-color", "var(--token-vfjxZCpBY)");

    var span = document.createElement("span");
    span.className = "framer-text";
    span.style.setProperty("--framer-text-color", "var(--token-vfjxZCpBY)");
    span.textContent = formatEvidenceLabel(ev);

    p.appendChild(span);
    textDiv.appendChild(p);
    row.appendChild(textDiv);
    return row;
  }

  function createCandidateCauseRowDOM(cause) {
    var row = document.createElement("div");
    row.className = "framer-15lhbe8";
    row.setAttribute("data-framer-name", cause.title || "Candidate Cause");
    row.style.width = "100%";
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";

    var leftDiv = document.createElement("div");
    leftDiv.className = "framer-ku9eke";
    leftDiv.setAttribute("data-framer-component-type", "RichTextContainer");
    leftDiv.style.transform = "none";
    leftDiv.style.flex = "1 1 auto";
    leftDiv.style.minWidth = "0";
    leftDiv.style.wordBreak = "break-word";

    var p = document.createElement("p");
    p.className = "framer-text framer-styles-preset-150qgy0";
    p.setAttribute("data-styles-preset", "LwAm2Brje");
    p.setAttribute("dir", "auto");
    p.style.setProperty("--framer-text-color", "var(--token-vfjxZCpBY)");

    var span = document.createElement("span");
    span.className = "framer-text";
    span.style.setProperty("--framer-text-color", "var(--token-vfjxZCpBY)");
    span.textContent = cause.title;
    if (cause.status === "ruled_out") {
      span.style.textDecoration = "line-through";
      span.style.opacity = "0.65";
    }
    p.appendChild(span);
    leftDiv.appendChild(p);

    // Display latest supporting/negative evidence reason note below cause title
    if (cause.notes) {
      var noteLines = String(cause.notes)
        .split("\n")
        .map(function (s) {
          return s.replace(/^\[[^\]]+\]\s*/, "").trim();
        })
        .filter(Boolean);
      if (noteLines.length > 0) {
        var noteDiv = document.createElement("div");
        noteDiv.className = "cluezy-cause-note";
        noteDiv.textContent = noteLines[noteLines.length - 1];
        leftDiv.appendChild(noteDiv);
      }
    }

    row.appendChild(leftDiv);

    // Badge: High -> framer-1u3sefx, Medium -> framer-2hyt8x, Low -> framer-1i0e59f
    var likelihood = cause.likelihood || "Medium";
    var badgeLabel =
      cause.status === "ruled_out"
        ? "Ruled Out"
        : cause.status === "confirmed"
        ? "High"
        : likelihood;
    var badgeClass =
      likelihood === "High"
        ? "framer-1u3sefx"
        : likelihood === "Medium"
        ? "framer-2hyt8x"
        : "framer-1i0e59f";

    var badgeDiv = document.createElement("div");
    badgeDiv.className = badgeClass;
    badgeDiv.setAttribute("data-framer-name", "Status " + likelihood);
    badgeDiv.style.flexShrink = "0";
    badgeDiv.style.alignSelf = "flex-start";
    badgeDiv.style.marginTop = "2px";

    var badgeInner = document.createElement("div");
    badgeInner.className = "framer-vaquvj";
    badgeInner.setAttribute("data-framer-component-type", "RichTextContainer");
    badgeInner.style.transform = "none";

    var bp = document.createElement("p");
    bp.className = "framer-text framer-styles-preset-150qgy0";
    bp.setAttribute("data-styles-preset", "LwAm2Brje");
    bp.setAttribute("dir", "auto");
    bp.style.setProperty("--framer-text-color", "var(--token-vfjxZCpBY)");

    var bspan = document.createElement("span");
    bspan.className = "framer-text";
    bspan.style.setProperty("--framer-text-color", "var(--token-vfjxZCpBY)");
    bspan.textContent = badgeLabel;

    bp.appendChild(bspan);
    badgeInner.appendChild(bp);
    badgeDiv.appendChild(badgeInner);
    row.appendChild(badgeDiv);

    return row;
  }

  /**
   * Automatically resize the chat reply composer textarea as the user types,
   * up to a max-height limit of 150px (approx 6-7 visible lines).
   */
  function autoResizeChatTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    var scrollH = el.scrollHeight;
    var maxHeight = 150;
    var minHeight = 24;
    if (scrollH > maxHeight) {
      el.style.height = maxHeight + "px";
      el.style.overflowY = "auto";
    } else {
      el.style.height = Math.max(scrollH, minHeight) + "px";
      el.style.overflowY = "hidden";
    }
  }

  /**
   * Handle submitting a message from the reply composer textarea.
   */
  async function handleComposerSubmit(textarea) {
    if (appState.isSubmitting) return;
    var rawText = (textarea.value || "").trim();
    if (!rawText) return;

    if (!appState.currentInvestigation) {
      await startNewInvestigation(rawText, textarea);
      return;
    }

    var inv = appState.currentInvestigation;
    var lastAssistantMsg = null;
    for (var i = inv.messages.length - 1; i >= 0; i--) {
      if (inv.messages[i].sender === "assistant") {
        lastAssistantMsg = inv.messages[i];
        break;
      }
    }
    var qId =
      lastAssistantMsg && lastAssistantMsg.extra_data
        ? lastAssistantMsg.extra_data.question_id
        : null;

    var savedDraft = rawText;
    textarea.value = "";
    autoResizeChatTextarea(textarea);
    appState.isSubmitting = true;
    appState.errorBannerMessage = null;
    renderInvestigationView();

    try {
      var updated = await API.submitMessage(inv.reference_id, savedDraft, qId);
      appState.currentInvestigation = updated;
    } catch (err) {
      // Restore user draft so it is never lost on network/API failure
      textarea.value = savedDraft;
      autoResizeChatTextarea(textarea);
      appState.errorBannerMessage = err.message || "Failed to send message. Please try again.";
    } finally {
      appState.isSubmitting = false;
      renderInvestigationView();
    }
  }

  /**
   * Start a brand-new investigation from a problem description.
   */
  async function startNewInvestigation(problemDescription, textareaToRestore) {
    if (appState.isSubmitting) return;
    var text = (problemDescription || "").trim();
    if (text.length < 5) {
      appState.errorBannerMessage = "Please describe your technical problem in at least 5 characters.";
      renderInvestigationView();
      return;
    }

    if (textareaToRestore) {
      textareaToRestore.value = "";
      autoResizeChatTextarea(textareaToRestore);
    }
    appState.isSubmitting = true;
    appState.errorBannerMessage = null;
    renderInvestigationView();

    try {
      var created = await API.createInvestigation(text);
      appState.currentInvestigation = created;
      if (created && created.reference_id && window.history && window.history.replaceState) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + "?id=" + encodeURIComponent(created.reference_id)
        );
      }
    } catch (err) {
      if (textareaToRestore) {
        textareaToRestore.value = text;
        autoResizeChatTextarea(textareaToRestore);
      }
      appState.errorBannerMessage = err.message || "Could not start investigation. Please retry.";
    } finally {
      appState.isSubmitting = false;
      renderInvestigationView();
    }
  }

  /**
   * Handle clicking any quick-reply chip in the investigation chat.
   */
  async function handleQuickReplyClick(inv, label, questionId) {
    if (appState.isSubmitting || !inv) return;
    var low = label.toLowerCase().replace("’", "'");

    // Navigation / Post-resolution quick actions
    if (low.indexOf("view full report") >= 0) {
      navigateTo("/resolved/", { id: inv.reference_id });
      return;
    }
    if (low.indexOf("save this fix") >= 0) {
      API.saveFixLocally(inv);
      appState.errorBannerMessage = null;
      navigateTo("/investigations/");
      return;
    }
    if (low.indexOf("start a new investigation") >= 0 || low.indexOf("restart investigation") >= 0) {
      API.setCurrentInvestigationId(null);
      appState.currentInvestigation = null;
      navigateTo("/investigation/", { new: "1" });
      return;
    }

    appState.isSubmitting = true;
    appState.errorBannerMessage = null;
    renderInvestigationView();

    try {
      var actions = Array.isArray(inv.recommended_actions) ? inv.recommended_actions : [];
      var activeAct =
        actions.filter(function (a) {
          return a.status === "pending";
        }).pop() || actions[actions.length - 1];
      var actId = activeAct ? activeAct.id : null;

      var updated;
      if (low.indexOf("yes, problem is resolved") >= 0 || low === "confirm resolution") {
        updated = await API.confirmResolution(inv.reference_id, label);
        appState.currentInvestigation = updated;
        navigateTo("/resolved/", { id: updated.reference_id });
        return;
      } else if (low.indexOf("it's working now") >= 0) {
        updated = await API.submitActionOutcome(inv.reference_id, actId, "working", label);
      } else if (low.indexOf("still not working") >= 0 || low.indexOf("still having issues") >= 0) {
        updated = await API.submitActionOutcome(inv.reference_id, actId, "not_working", label);
      } else if (low.indexOf("i need help") >= 0) {
        updated = await API.submitActionOutcome(inv.reference_id, actId, "need_help", label);
      } else {
        updated = await API.submitDiagnosticAnswer(inv.reference_id, questionId, label, label);
      }
      appState.currentInvestigation = updated;
    } catch (err) {
      appState.errorBannerMessage = err.message || "Failed to submit answer. Please retry.";
    } finally {
      appState.isSubmitting = false;
      renderInvestigationView();
    }
  }

  // ============================================================================
  // 3. SOLUTION WALKTHROUGH PAGE CONTROLLER (/solution/index.html)
  // ============================================================================
  function renderSolutionView() {
    var root = document.querySelector('[data-framer-name="solution content"]');
    if (!root) return;

    appState.isUpdatingDOM = true;
    try {
      root.setAttribute("data-cluezy-rendered", "true");
      var inv = appState.currentInvestigation;
      if (!inv) return;

      // 1. Update Heading
      var headingH1 = root.querySelector("h1");
      if (headingH1) {
        headingH1.textContent = "Investigation  #" + inv.reference_id;
      }

      // 2. Identify active RecommendedAction & Top Candidate Cause
      var actions = Array.isArray(inv.recommended_actions) ? inv.recommended_actions : [];
      var activeAct =
        actions.filter(function (a) {
          return a.status === "pending";
        }).pop() || actions[actions.length - 1];

      var causes = Array.isArray(inv.candidate_causes) ? inv.candidate_causes.slice() : [];
      causes.sort(function (a, b) {
        return (b.confidence_score || 0) - (a.confidence_score || 0);
      });
      var topCause = causes[0];

      // 3. Update Step Subheading
      var stepSubP = root.querySelector('[data-framer-name="Step 2 of 3 · Testing a solution"] span, .framer-1w8ad4e span');
      if (stepSubP) {
        if (appState.awaitingExplicitConfirmation) {
          stepSubP.textContent = "Final Step · Explicitly Confirm Resolution";
        } else if (activeAct) {
          stepSubP.textContent =
            "Step " +
            (activeAct.step_number || 2) +
            " of " +
            (activeAct.total_steps || 3) +
            " · Testing a solution (" +
            (topCause ? topCause.title : "Recommended Fix") +
            ")";
        }
      }

      // 4. Update Diagnosis Card & Steps
      var diagCard = root.querySelector('[data-framer-name="DNS diagnosis"]');
      if (diagCard) {
        var introP = diagCard.querySelector(".framer-1cye3qs p");
        var subIntroP = diagCard.querySelector(".framer-1qydjjz p");
        var stepsBox = diagCard.querySelector('[data-framer-name="Change DNS steps"]');
        var footerP = diagCard.querySelector(".framer-b97f9y p");
        var timeP = diagCard.querySelector(".framer-1iqpv4o p");

        if (introP && topCause) {
          var reasonLine = topCause.notes
            ? topCause.notes.split("\n").pop().replace(/^\[[^\]]+\]\s*/, "")
            : "Based on our diagnostic checks, this is the leading candidate cause.";
          introP.textContent =
            "Leading Cause: " + topCause.title + " (" + topCause.likelihood + " likelihood). " + reasonLine;
        }
        if (subIntroP) {
          subIntroP.textContent = appState.awaitingExplicitConfirmation
            ? "You reported the fix worked! Please confirm everything is working normally to generate your final resolution report."
            : "Follow these step-by-step instructions:";
        }

        if (stepsBox && activeAct) {
          var titleH2 = stepsBox.querySelector("h2");
          if (titleH2) {
            titleH2.textContent = activeAct.title;
          }
          var titleContainer = stepsBox.querySelector(".framer-o7e1v");
          Array.from(stepsBox.children).forEach(function (ch) {
            if (ch !== titleContainer) {
              stepsBox.removeChild(ch);
            }
          });

          var stepsList = Array.isArray(activeAct.steps) ? activeAct.steps : [];
          stepsList.forEach(function (stepStr, idx) {
            var stepDiv = document.createElement("div");
            stepDiv.className = "framer-5iotyh";
            stepDiv.setAttribute("data-framer-component-type", "RichTextContainer");
            stepDiv.style.transform = "none";

            var sp = document.createElement("p");
            sp.className = "framer-text framer-styles-preset-g5gvkz";
            sp.setAttribute("data-styles-preset", "HNZA9_QSM");
            sp.setAttribute("dir", "auto");
            var cleanStep = String(stepStr).replace(/^\d+\.\s*/, "");
            sp.textContent = idx + 1 + ".  " + cleanStep;
            stepDiv.appendChild(sp);
            stepsBox.appendChild(stepDiv);
          });

          if (activeAct.expected_result) {
            var expDiv = document.createElement("div");
            expDiv.className = "cluezy-banner-info";
            expDiv.textContent = "Expected Result: " + activeAct.expected_result;
            stepsBox.appendChild(expDiv);
          }

          if (appState.inlineHelpText) {
            var helpDiv = document.createElement("div");
            helpDiv.className = "cluezy-banner-info";
            helpDiv.style.marginTop = "10px";
            helpDiv.style.whiteSpace = "pre-line";
            appendFormattedTextSafely(helpDiv, appState.inlineHelpText);
            stepsBox.appendChild(helpDiv);
          }
        }

        if (footerP) {
          footerP.textContent = appState.awaitingExplicitConfirmation
            ? "Resolution is only finalized when you explicitly confirm below."
            : "Let me know what happens after testing these steps.";
        }
        if (timeP) {
          timeP.textContent = formatTime(inv.updated_at || inv.created_at);
        }
      }

      // 5. Render Action Outcome Choice Buttons
      var choicesContainer = root.querySelector('[data-framer-name="Fix result choices"]');
      if (choicesContainer) {
        choicesContainer.innerHTML = "";
        var actId = activeAct ? activeAct.id : null;

        if (appState.awaitingExplicitConfirmation) {
          var confirmBtn = createQuickReplyButtonDOM(
            "Yes, Confirm Problem is Resolved",
            true,
            async function () {
              appState.isSubmitting = true;
              renderSolutionView();
              try {
                var resolvedInv = await API.confirmResolution(
                  inv.reference_id,
                  "User explicitly confirmed fix resolved the issue on Solution Walkthrough."
                );
                appState.currentInvestigation = resolvedInv;
                navigateTo("/resolved/", { id: resolvedInv.reference_id });
              } catch (err) {
                appState.isSubmitting = false;
                renderSolutionView();
              }
            }
          );
          var notYetBtn = createQuickReplyButtonDOM(
            "Wait, Still Not Working",
            false,
            async function () {
              appState.awaitingExplicitConfirmation = false;
              await handleSolutionOutcome(inv, actId, "not_working");
            }
          );
          choicesContainer.appendChild(confirmBtn);
          choicesContainer.appendChild(notYetBtn);
        } else {
          var workingBtn = createQuickReplyButtonDOM("It’s working now", true, async function () {
            await handleSolutionOutcome(inv, actId, "working");
          });
          var failedBtn = createQuickReplyButtonDOM("Still not working", false, async function () {
            await handleSolutionOutcome(inv, actId, "not_working");
          });
          var helpBtn = createQuickReplyButtonDOM("I need help", false, async function () {
            await handleSolutionOutcome(inv, actId, "need_help");
          });
          var backBtn = createQuickReplyButtonDOM("Back to Chat", false, function () {
            navigateTo("/investigation/", { id: inv.reference_id });
          });

          choicesContainer.appendChild(workingBtn);
          choicesContainer.appendChild(failedBtn);
          choicesContainer.appendChild(helpBtn);
          choicesContainer.appendChild(backBtn);
        }
      }
    } finally {
      appState.isUpdatingDOM = false;
    }
  }

  async function handleSolutionOutcome(inv, actionId, outcome) {
    if (appState.isSubmitting || !inv) return;
    appState.isSubmitting = true;
    renderSolutionView();

    try {
      var updated = await API.submitActionOutcome(inv.reference_id, actionId, outcome);
      appState.currentInvestigation = updated;

      if (outcome === "working") {
        // Require explicit confirmation before resolving!
        appState.awaitingExplicitConfirmation = true;
        appState.isSubmitting = false;
        renderSolutionView();
      } else if (outcome === "not_working") {
        // Return to investigation chat to continue exploring alternative causes
        navigateTo("/investigation/", { id: updated.reference_id });
      } else if (outcome === "need_help") {
        var lastMsg = updated.messages && updated.messages[updated.messages.length - 1];
        appState.inlineHelpText =
          lastMsg && lastMsg.sender === "assistant"
            ? lastMsg.content
            : "Press Win + R, type cmd, and execute each step carefully.";
        appState.isSubmitting = false;
        renderSolutionView();
      }
    } catch (_err) {
      appState.isSubmitting = false;
      renderSolutionView();
    }
  }

  // ============================================================================
  // 4. RESOLVED PAGE AND REPORTS CONTROLLER (/resolved/index.html)
  // ============================================================================
  function renderResolvedView() {
    var root = document.querySelector('[data-framer-name="resolved content"]');
    if (!root) return;

    appState.isUpdatingDOM = true;
    try {
      root.setAttribute("data-cluezy-rendered", "true");
      var inv = appState.currentInvestigation;
      if (!inv) return;

      var headingH1 = root.querySelector('[data-framer-name="Problem Resolved!"] h1');
      var subtitleSpan = root.querySelector(
        '[data-framer-name="Your issue was fixed by updating the DNS"] span, .framer-1rpe3e4 span'
      );
      var issueDescP = root.querySelector('[data-framer-name="What was the issue?"] .framer-1w276xg p');
      var fixDescP = root.querySelector('[data-framer-name="What fixed it?"] .framer-u4ka4c p');
      var saveFixLink = root.querySelector('[data-framer-name="Save this Fix"] a');
      var viewReportLink = root.querySelector('[data-framer-name="View Full Report"] a');
      var startNewLink = root.querySelector('[data-framer-name="Start a new investigation"]');

      // Enforce Requirement 9: Only show a resolved report after explicit confirmation
      if (inv.status !== "resolved" || !inv.report) {
        if (headingH1) headingH1.textContent = "Awaiting Resolution Confirmation";
        if (subtitleSpan) {
          subtitleSpan.textContent =
            "Investigation #" +
            inv.reference_id +
            " is still active. Please explicitly confirm resolution to generate the final report.";
        }
        if (issueDescP) {
          issueDescP.textContent = "Original Issue: " + inv.problem_description;
        }
        if (fixDescP) {
          fixDescP.textContent = "Click 'Confirm Resolution Now' below once you verify your issue is fixed.";
        }
        if (saveFixLink) {
          var sSpan = saveFixLink.querySelector("span");
          if (sSpan) sSpan.textContent = "Confirm Resolution Now";
          bindActionClick(saveFixLink, async function () {
            appState.isSubmitting = true;
            try {
              var resolved = await API.confirmResolution(inv.reference_id);
              appState.currentInvestigation = resolved;
            } finally {
              appState.isSubmitting = false;
              renderResolvedView();
            }
          });
        }
        if (viewReportLink) {
          var vSpan = viewReportLink.querySelector("span");
          if (vSpan) vSpan.textContent = "Return to Investigation";
          bindActionClick(viewReportLink, function () {
            navigateTo("/investigation/", { id: inv.reference_id });
          });
        }
      } else {
        var report = inv.report;
        if (headingH1) {
          headingH1.textContent = "Problem Resolved! (#" + inv.reference_id + ")";
        }
        if (subtitleSpan) {
          subtitleSpan.textContent = report.summary || "Your issue was diagnosed and verified resolved.";
        }
        if (issueDescP) {
          var evFacts = (inv.evidence || [])
            .filter(function (e) {
              return e.value && e.value !== "None" && e.value !== "unknown";
            })
            .map(function (e) {
              return formatEvidenceLabel(e);
            })
            .join(" | ");
          issueDescP.textContent =
            report.root_cause +
            ". Original problem: \"" +
            inv.problem_description +
            "\"" +
            (evFacts ? " (Supporting Evidence: " + evFacts + ")" : "");
        }
        if (fixDescP) {
          var stepsText = Array.isArray(report.resolution_steps)
            ? report.resolution_steps.join(" → ")
            : "";
          var prevText =
            appState.expandedFullReport && Array.isArray(report.preventative_measures)
              ? " | Preventative Recommendations: " + report.preventative_measures.join("; ")
              : "";
          fixDescP.textContent =
            report.fix_applied + (stepsText ? " (" + stepsText + ")" : "") + prevText;
        }

        if (saveFixLink) {
          var saveSpan = saveFixLink.querySelector("span");
          bindActionClick(saveFixLink, function () {
            API.saveFixLocally(inv);
            if (saveSpan) saveSpan.textContent = "Fix Saved ✓";
          });
        }

        if (viewReportLink) {
          var viewSpan = viewReportLink.querySelector("span");
          if (viewSpan) {
            viewSpan.textContent = appState.expandedFullReport
              ? "Hide Preventative Details"
              : "View Full Report";
          }
          bindActionClick(viewReportLink, function () {
            appState.expandedFullReport = !appState.expandedFullReport;
            renderResolvedView();
          });
        }
      }

      if (startNewLink) {
        bindActionClick(startNewLink, function () {
          API.setCurrentInvestigationId(null);
          appState.currentInvestigation = null;
          navigateTo("/investigation/", { new: "1" });
        });
      }
    } finally {
      appState.isUpdatingDOM = false;
    }
  }

  // ============================================================================
  // 5. INVESTIGATION HISTORY CONTROLLER (/investigations/index.html)
  // ============================================================================
  function renderInvestigationsListView() {
    var root = document.querySelector('[data-framer-name="investigations content"]');
    if (!root) return;

    appState.isUpdatingDOM = true;
    try {
      root.setAttribute("data-cluezy-rendered", "true");

      // 1. Interactive Search Input
      var searchBox = root.querySelector('[data-framer-name="Search investigations..."]');
      if (searchBox && !searchBox.querySelector("input.cluezy-search-input")) {
        searchBox.innerHTML = "";
        var sInput = document.createElement("input");
        sInput.type = "text";
        sInput.className = "cluezy-search-input";
        sInput.placeholder = "Search investigations by #INV ID or title…";
        sInput.value = appState.searchQuery;
        sInput.addEventListener("input", function () {
          appState.searchQuery = sInput.value;
          renderInvestigationCardsList(root);
        });
        searchBox.appendChild(sInput);
      }

      // 2. Two Categories: In Progress and Completed
      var statusContainer = root.querySelector('[data-framer-name="Status All Status"]');
      if (statusContainer) {
        statusContainer.innerHTML = "";
        statusContainer.style.background = "transparent";
        statusContainer.style.border = "none";
        statusContainer.style.padding = "0";

        var tabsDiv = document.createElement("div");
        tabsDiv.className = "cluezy-category-tabs";

        var inProgBtn = document.createElement("button");
        var isInProg = appState.statusFilter !== "resolved";
        inProgBtn.className = "cluezy-category-tab" + (isInProg ? " active" : "");
        inProgBtn.textContent = "In Progress";
        bindActionClick(inProgBtn, function () {
          appState.statusFilter = "active";
          renderInvestigationsListView();
        });

        var compBtn = document.createElement("button");
        compBtn.className = "cluezy-category-tab" + (!isInProg ? " active" : "");
        compBtn.textContent = "Completed";
        bindActionClick(compBtn, function () {
          appState.statusFilter = "resolved";
          renderInvestigationsListView();
        });

        tabsDiv.appendChild(inProgBtn);
        tabsDiv.appendChild(compBtn);
        statusContainer.appendChild(tabsDiv);
      }

      // 3. New Investigation Button
      var newBtn = root.querySelector('[data-framer-name="New Investigation"] a');
      if (newBtn) {
        bindActionClick(newBtn, function () {
          API.setCurrentInvestigationId(null);
          navigateTo("/investigation/", { new: "1" });
        });
      }

      // 4. Render Cards
      renderInvestigationCardsList(root);
    } finally {
      appState.isUpdatingDOM = false;
    }
  }

  function renderInvestigationCardsList(root) {
    var listContainer = root.querySelector('[data-framer-name="Investigation list"]');
    if (!listContainer) return;

    listContainer.innerHTML = "";

    var filtered = (appState.investigationsList || []).filter(function (item) {
      if (appState.statusFilter === "resolved" && item.status !== "resolved") return false;
      if (appState.statusFilter === "active" && item.status === "resolved") return false;
      if (appState.searchQuery && appState.searchQuery.trim()) {
        var q = appState.searchQuery.trim().toLowerCase();
        var matchRef = (item.reference_id || "").toLowerCase().indexOf(q) >= 0;
        var matchTitle = (item.title || "").toLowerCase().indexOf(q) >= 0;
        var matchDesc = (item.problem_description || "").toLowerCase().indexOf(q) >= 0;
        if (!matchRef && !matchTitle && !matchDesc) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      var emptyCard = document.createElement("div");
      emptyCard.className = "framer-1xep79e framer-twck85";
      emptyCard.setAttribute("data-border", "true");
      emptyCard.style.padding = "20px";

      var detailsDiv = document.createElement("div");
      detailsDiv.className = "framer-nlyvx1";
      var p = document.createElement("p");
      p.className = "framer-text framer-styles-preset-g5gvkz";
      p.textContent =
        appState.investigationsList.length === 0
          ? "No past investigations found for this session yet. Click 'New Investigation' below to start troubleshooting."
          : "No investigations match your current search/filter.";
      detailsDiv.appendChild(p);
      emptyCard.appendChild(detailsDiv);
      listContainer.appendChild(emptyCard);
      return;
    }

    filtered.forEach(function (item) {
      var isResolved = item.status === "resolved";
      var a = document.createElement("a");
      a.className = "framer-1xep79e framer-twck85";
      a.setAttribute("data-border", "true");
      a.setAttribute("data-framer-name", item.title || item.reference_id);
      a.setAttribute("href", "/investigation/?id=" + encodeURIComponent(item.reference_id));

      // Category SVG icon
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "framer-AxTtK framer-40pjob");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("role", "presentation");
      var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#1362789546");
      svg.appendChild(use);
      a.appendChild(svg);

      // Details container
      var details = document.createElement("div");
      details.className = "framer-nlyvx1";
      details.setAttribute("data-framer-name", "Investigation details");

      var refWrap = document.createElement("div");
      refWrap.className = "framer-tr9q8b";
      refWrap.setAttribute("data-framer-component-type", "RichTextContainer");
      refWrap.style.transform = "none";
      var refP = document.createElement("p");
      refP.className = "framer-text framer-styles-preset-1hewirz";
      refP.setAttribute("data-styles-preset", "Z1BYkLRW1");
      refP.textContent = "#" + item.reference_id;
      refWrap.appendChild(refP);

      var titleWrap = document.createElement("div");
      titleWrap.className = "framer-tp9wga";
      titleWrap.setAttribute("data-framer-component-type", "RichTextContainer");
      titleWrap.style.transform = "none";
      var titleP = document.createElement("p");
      titleP.className = "framer-text framer-styles-preset-g5gvkz";
      titleP.setAttribute("data-styles-preset", "HNZA9_QSM");
      titleP.textContent = item.title;
      titleWrap.appendChild(titleP);

      var metaWrap = document.createElement("div");
      metaWrap.className = "framer-1ag8mch";
      metaWrap.setAttribute("data-framer-component-type", "RichTextContainer");
      metaWrap.style.transform = "none";
      var metaP = document.createElement("p");
      metaP.className = "framer-text framer-styles-preset-150qgy0";
      metaP.setAttribute("data-styles-preset", "LwAm2Brje");
      metaP.textContent =
        formatDate(item.created_at) + " · " + (item.message_count || 0) + " messages";
      metaWrap.appendChild(metaP);

      details.appendChild(refWrap);
      details.appendChild(titleWrap);
      details.appendChild(metaWrap);
      a.appendChild(details);

      // Status badge
      var statusBadge = document.createElement("div");
      statusBadge.className = isResolved
        ? "framer-11jjf5q hidden-dyjihb"
        : "framer-1y1wa10 hidden-dyjihb";
      statusBadge.setAttribute(
        "data-framer-name",
        isResolved ? "Status Resolved" : "Status In Progress"
      );

      var statusInner = document.createElement("div");
      statusInner.className = "framer-1kge8pt";
      statusInner.setAttribute("data-framer-component-type", "RichTextContainer");
      statusInner.style.transform = "none";
      var statusP = document.createElement("p");
      statusP.className = "framer-text framer-styles-preset-150qgy0";
      statusP.setAttribute("data-styles-preset", "LwAm2Brje");
      statusP.style.setProperty("--framer-text-color", "var(--token-aW35IeuAs)");
      var statusSpan = document.createElement("span");
      statusSpan.className = "framer-text";
      statusSpan.style.setProperty("--framer-text-color", "var(--token-aW35IeuAs)");
      statusSpan.textContent = isResolved ? "Resolved" : "In Progress";
      statusP.appendChild(statusSpan);
      statusInner.appendChild(statusP);
      statusBadge.appendChild(statusInner);
      a.appendChild(statusBadge);

      bindActionClick(a, function () {
        API.setCurrentInvestigationId(item.reference_id);
        navigateTo("/investigation/", { id: item.reference_id });
      });

      listContainer.appendChild(a);
    });
  }

  // ============================================================================
  // INITIALIZATION & LIFECYCLE ORCHESTRATOR
  // ============================================================================
  var dataLoadStarted = false;

  async function loadInitialBackendState() {
    if (dataLoadStarted) return;
    dataLoadStarted = true;

    try {
      var user = null;
      try {
        user = await API.getAuthUser();
      } catch (_e) {}

      if (user) {
        try {
          await API.claimAnonymousInvestigations();
        } catch (_claimErr) {}
      } else {
        await API.getOrCreateSession(false);
      }

      bindUserProfile();

      var params = new URLSearchParams(window.location.search || "");
      var isExplicitNew = params.get("new") === "1";
      if (isExplicitNew) {
        API.setCurrentInvestigationId(null);
        appState.currentInvestigation = null;
      }

      if (params.get("filter") === "resolved") {
        appState.statusFilter = "resolved";
      }

      var path = window.location.pathname || "/";
      var isHistoryPage = path.indexOf("/investigations") === 0;
      var isInvestigationPage =
        path.indexOf("/investigation") === 0 && !isHistoryPage;
      var isSolutionPage = path.indexOf("/solution") === 0;
      var isResolvedPage = path.indexOf("/resolved") === 0;

      if (isHistoryPage) {
        var listData = await API.listInvestigations({ page: 1, page_size: 50 });
        appState.investigationsList = (listData && listData.items) || [];
        renderInvestigationsListView();
        renderSidebarRecentInvestigations(appState.investigationsList);
        return;
      }

      if (isInvestigationPage || isSolutionPage || isResolvedPage) {
        var draft = API.getDraftProblem();
        if (isInvestigationPage && draft && draft.trim().length >= 5) {
          API.setDraftProblem(null);
          await startNewInvestigation(draft);
          return;
        }

        var urlId = params.get("id");
        var targetId = !isExplicitNew ? (urlId || API.getCurrentInvestigationId()) : null;
        if (urlId) {
          API.setCurrentInvestigationId(urlId);
        }

        if (!targetId && !isExplicitNew) {
          // Check if the user has a recent investigation in Supabase
          try {
            var recentList = await API.listInvestigations({ page: 1, page_size: 1 });
            if (recentList && recentList.items && recentList.items.length > 0) {
              targetId = recentList.items[0].reference_id;
              API.setCurrentInvestigationId(targetId);
            }
          } catch (_e) {}
        }

        if (targetId) {
          try {
            var inv = await API.getInvestigation(targetId);
            appState.currentInvestigation = inv;
            API.setCurrentInvestigationId(inv.reference_id);
          } catch (_notFoundErr) {
            API.setCurrentInvestigationId(null);
            appState.currentInvestigation = null;
          }
        }

        mountCurrentRouteDOM();
      }
    } catch (err) {
      appState.errorBannerMessage = err.message || "Unable to connect to backend server.";
      mountCurrentRouteDOM();
    }
  }

  /**
   * Detect which page component is present in the DOM and mount/render it.
   */
  function mountCurrentRouteDOM() {
    if (appState.isUpdatingDOM) return;
    ensureHelperStyles();
    bindSidebarAndSessionQuota();

    var heroEl = document.querySelector('[data-framer-name="Troubleshooting hero"]');
    if (heroEl && heroEl.getAttribute("data-cluezy-rendered") !== "true") {
      mountLandingPage(heroEl);
    }

    var invEl = document.querySelector('[data-framer-name="investigation content"]');
    var solEl = document.querySelector('[data-framer-name="solution content"]');
    var resEl = document.querySelector('[data-framer-name="resolved content"]');

    if (invEl || solEl || resEl) {
      document.documentElement.classList.add("cluezy-no-page-scroll");
      document.body.classList.add("cluezy-no-page-scroll");
    } else {
      document.documentElement.classList.remove("cluezy-no-page-scroll");
      document.body.classList.remove("cluezy-no-page-scroll");
    }

    if (invEl) {
      renderInvestigationView();
    }

    if (solEl) {
      renderSolutionView();
    }

    if (resEl) {
      renderResolvedView();
    }

    var listEl = document.querySelector('[data-framer-name="investigations content"]');
    if (listEl) {
      renderInvestigationsListView();
    }
  }

  function registerGlobalDelegatedClickHandlers() {
    if (window._cluezyGlobalDelegationBound) return;
    window._cluezyGlobalDelegationBound = true;

    document.addEventListener(
      "click",
      function (e) {
        var target = e.target;
        if (!target || typeof target.closest !== "function") return;

        // If an element already has a direct _cluezyClickHandler on itself or an ancestor, let that run
        var directBound = target.closest(".cluezy-clickable");
        if (directBound && directBound._cluezyClickHandler) return;

        var startBtn = target.closest(
          '[data-framer-name="Start Troubleshooting"], [data-framer-name="Get Started"]'
        );
        if (startBtn) {
          e.preventDefault();
          e.stopPropagation();
          var heroInp = document.querySelector(".cluezy-hero-input");
          if (heroInp && heroInp.value.trim()) {
            API.setDraftProblem(heroInp.value.trim());
          }
          API.setCurrentInvestigationId(null);
          navigateTo("/investigation/", { new: "1" });
          return;
        }

        var newInvBtn = target.closest(
          '[data-framer-name="New Investigation"], [data-framer-name="Start a new investigation"]'
        );
        if (newInvBtn) {
          e.preventDefault();
          e.stopPropagation();
          API.setCurrentInvestigationId(null);
          navigateTo("/investigation/", { new: "1" });
          return;
        }

        var googleSignInBtn = target.closest('#cluezy-header-google-btn, .cluezy-google-btn');
        if (googleSignInBtn) {
          e.preventDefault();
          e.stopPropagation();
          var textSpan = googleSignInBtn.querySelector(".cluezy-google-btn-text");
          if (textSpan) textSpan.textContent = "Connecting...";
          googleSignInBtn.disabled = true;
          API.signInWithGoogle("/investigation/");
          return;
        }

        var signInBtn = target.closest('[data-framer-name="Sign In"]');
        if (signInBtn) {
          e.preventDefault();
          e.stopPropagation();
          API.isAuthenticated().then(function (auth) {
            if (auth) {
              navigateTo("/investigations/");
            } else {
              API.signInWithGoogle("/investigations/");
            }
          }).catch(function () {
            API.signInWithGoogle("/investigations/");
          });
          return;
        }

        var myInvBtn = target.closest('[data-framer-name="My Investigations"]');
        if (myInvBtn) {
          e.preventDefault();
          e.stopPropagation();
          navigateTo("/investigations/");
          return;
        }

        var kbBtn = target.closest('[data-framer-name="Knowledge Base"]');
        if (kbBtn) {
          e.preventDefault();
          e.stopPropagation();
          navigateTo("/knowledge-base/");
          return;
        }

        var savedBtn = target.closest('[data-framer-name="Saved Fixes"]');
        if (savedBtn) {
          e.preventDefault();
          e.stopPropagation();
          navigateTo("/investigations/", { filter: "resolved" });
          return;
        }
      },
      true
    );
  }

  function initApp() {
    ensureHelperStyles();
    registerGlobalDelegatedClickHandlers();
    mountCurrentRouteDOM();
    loadInitialBackendState();
    bindLandingHeaderAuth();

    // Listen to Supabase auth state changes
    API.onAuthStateChange(function (event, session) {
      bindUserProfile();
      bindLandingHeaderAuth();
      if (event === "SIGNED_IN") {
        API.claimAnonymousInvestigations()
          .then(function () {
            return API.listInvestigations({ page: 1, page_size: 5 });
          })
          .then(function (res) {
            if (res && Array.isArray(res.items)) {
              renderSidebarRecentInvestigations(res.items);
            }
          })
          .catch(function () {});
      }
    });

    window.addEventListener("popstate", function () {
      dataLoadStarted = false;
      loadInitialBackendState();
    });
    window.addEventListener("pageshow", function (event) {
      if (event && event.persisted) {
        dataLoadStarted = false;
        loadInitialBackendState();
      }
    });

    // Watch #main so if Framer's hydration script replaces DOM nodes on startup or breakpoint changes,
    // our controller immediately re-binds and re-renders the live backend state without flicker.
    var mainEl = document.getElementById("main") || document.body;
    var observer = new MutationObserver(function () {
      if (appState.isUpdatingDOM) return;
      var activeSection = document.querySelector(
        '[data-framer-name="investigation content"], ' +
          '[data-framer-name="solution content"], ' +
          '[data-framer-name="resolved content"], ' +
          '[data-framer-name="investigations content"], ' +
          '[data-framer-name="Troubleshooting hero"]'
      );
      if (activeSection && activeSection.getAttribute("data-cluezy-rendered") !== "true") {
        mountCurrentRouteDOM();
      }
    });
    observer.observe(mainEl, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();

