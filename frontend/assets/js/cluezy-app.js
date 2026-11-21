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
   * Escape HTML special characters to prevent XSS when building HTML strings.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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
      ".cluezy-input-bar-enhanced {",
      "  border-radius: 16px !important;",
      "  border: 1.5px solid var(--token-CrOEkw8uh, #dfe5de) !important;",
      "  background: #ffffff !important;",
      "  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.04) !important;",
      "  transition: border-color 0.15s ease, box-shadow 0.15s ease !important;",
      "}",
      ".cluezy-input-bar-enhanced:focus-within {",
      "  border-color: var(--token-aW35IeuAs, #145c38) !important;",
      "  box-shadow: 0 0 0 3px rgba(20, 92, 56, 0.12), 0 4px 16px rgba(20, 92, 56, 0.08) !important;",
      "}",
      ".cluezy-new-investigation-layout {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  justify-content: flex-start !important;",
      "  align-items: center !important;",
      "  min-height: 100% !important;",
      "  padding: 28px 20px 48px !important;",
      "  box-sizing: border-box !important;",
      "  overflow-y: auto !important;",
      "}",
      ".cluezy-new-investigation-layout [data-framer-name='Reply composer'],",
      ".cluezy-new-investigation-layout .framer-sz1ut5 {",
      "  margin-top: 0 !important;",
      "  margin-bottom: 0 !important;",
      "  max-width: 680px !important;",
      "}",
      ".cluezy-hero-welcome-section {",
      "  text-align: center !important;",
      "  max-width: 680px !important;",
      "  width: 100% !important;",
      "  margin-bottom: 22px !important;",
      "}",
      ".cluezy-hero-badge {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 6px !important;",
      "  padding: 4px 12px !important;",
      "  border-radius: 20px !important;",
      "  background: #ecf6e8 !important;",
      "  color: #145c38 !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 11.5px !important;",
      "  font-weight: 700 !important;",
      "  letter-spacing: 0.03em !important;",
      "  text-transform: uppercase !important;",
      "  margin-bottom: 12px !important;",
      "}",
      ".cluezy-hero-title {",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 26px !important;",
      "  font-weight: 800 !important;",
      "  letter-spacing: -0.025em !important;",
      "  color: #17251f !important;",
      "  margin: 0 0 8px 0 !important;",
      "  line-height: 1.25 !important;",
      "}",
      ".cluezy-hero-subtitle {",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 13.5px !important;",
      "  color: #58655e !important;",
      "  margin: 0 !important;",
      "  line-height: 1.5 !important;",
      "}",
      ".cluezy-starter-categories {",
      "  display: flex !important;",
      "  flex-wrap: wrap !important;",
      "  gap: 8px !important;",
      "  justify-content: center !important;",
      "  max-width: 680px !important;",
      "  width: 100% !important;",
      "  margin-top: 18px !important;",
      "  margin-bottom: 14px !important;",
      "}",
      ".cluezy-category-pill {",
      "  padding: 6px 14px !important;",
      "  border-radius: 20px !important;",
      "  font-size: 12px !important;",
      "  font-weight: 500 !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  border: 1px solid #dfe5de !important;",
      "  background: #ffffff !important;",
      "  color: #58655e !important;",
      "  cursor: pointer !important;",
      "  transition: all 0.15s ease !important;",
      "  white-space: nowrap !important;",
      "}",
      ".cluezy-category-pill:hover {",
      "  background: #ecf6e8 !important;",
      "  color: #145c38 !important;",
      "  border-color: #b5dda9 !important;",
      "}",
      ".cluezy-category-pill.active {",
      "  background: #145c38 !important;",
      "  color: #ffffff !important;",
      "  border-color: #145c38 !important;",
      "  font-weight: 600 !important;",
      "}",
      ".cluezy-new-investigation-layout [data-framer-name='Diagnostic answers'] {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 8px !important;",
      "  max-width: 680px !important;",
      "  width: 100% !important;",
      "  margin: 0 auto !important;",
      "}",
      ".cluezy-starter-card {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  background: #fcfbf9 !important;",
      "  border: 1px solid #dfe5de !important;",
      "  border-radius: 12px !important;",
      "  padding: 10px 14px !important;",
      "  cursor: pointer !important;",
      "  text-decoration: none !important;",
      "  transition: all 0.15s ease !important;",
      "  box-sizing: border-box !important;",
      "  width: 100% !important;",
      "  gap: 12px !important;",
      "}",
      ".cluezy-starter-card:hover {",
      "  background: #ecf6e8 !important;",
      "  border-color: #145c38 !important;",
      "  transform: translateY(-1px) !important;",
      "  box-shadow: 0 3px 10px rgba(20, 92, 56, 0.08) !important;",
      "}",
      ".cluezy-starter-card-label {",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 13px !important;",
      "  font-weight: 500 !important;",
      "  color: #17251f !important;",
      "  text-align: left !important;",
      "  line-height: 1.4 !important;",
      "}",
      ".cluezy-starter-card:hover .cluezy-starter-card-label {",
      "  color: #145c38 !important;",
      "}",
      ".cluezy-starter-card-arrow {",
      "  color: #58655e !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  flex-shrink: 0 !important;",
      "  transition: transform 0.15s ease, color 0.15s ease !important;",
      "}",
      ".cluezy-starter-card:hover .cluezy-starter-card-arrow {",
      "  color: #145c38 !important;",
      "  transform: translateX(3px) !important;",
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
      "  margin: 0 !important;",
      "  padding: 0 !important;",
      "}",
      "body.cluezy-no-page-scroll [data-layout-template='true'],",
      ".framer-sbem9.framer-n22pd4 {",
      "  width: 100vw !important;",
      "  max-width: 100vw !important;",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  padding: 0 0 0 230px !important;",
      "  margin: 0 !important;",
      "  overflow: hidden !important;",
      "  box-sizing: border-box !important;",
      "  display: flex !important;",
      "  flex-direction: row !important;",
      "  align-items: stretch !important;",
      "}",
      "/* Left sidebar pinned fixed full height */",
      "[data-framer-name='Sidebar'],",
      ".framer-sbem9 .framer-r5haeu {",
      "  position: fixed !important;",
      "  left: 0 !important;",
      "  top: 0 !important;",
      "  bottom: 0 !important;",
      "  width: 230px !important;",
      "  min-width: 230px !important;",
      "  max-width: 230px !important;",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  background-color: var(--token-cPoBWZDTB, #073b27) !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  justify-content: space-between !important;",
      "  padding: 18px 12px 14px 12px !important;",
      "  box-sizing: border-box !important;",
      "  z-index: 9999 !important;",
      "  overflow: hidden !important;",
      "  gap: 8px !important;",
      "}",
      "[data-framer-name='Cluezy brand'] {",
      "  flex: none !important;",
      "  margin-bottom: 6px !important;",
      "}",
      "[data-framer-name='Workspace navigation'] {",
      "  flex: 1 1 auto !important;",
      "  min-height: 0 !important;",
      "  overflow-y: auto !important;",
      "  overflow-x: hidden !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 4px !important;",
      "  margin-bottom: 6px !important;",
      "  padding-right: 2px !important;",
      "}",
      "[data-framer-name='Sidebar space'] {",
      "  display: none !important;",
      "}",
      "[data-framer-name='Free plan usage'],",
      ".framer-we2i1d {",
      "  display: block !important;",
      "  flex: none !important;",
      "  width: 100% !important;",
      "  margin-top: auto !important;",
      "  margin-bottom: 8px !important;",
      "  padding: 10px 12px !important;",
      "  box-sizing: border-box !important;",
      "  border-radius: 9px !important;",
      "  background: rgba(255, 255, 255, 0.05) !important;",
      "  border: 1px solid rgba(255, 255, 255, 0.08) !important;",
      "}",
      "[data-framer-name='Profile'],",
      ".framer-6i2sda {",
      "  display: flex !important;",
      "  flex: none !important;",
      "  width: 100% !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  padding: 8px 10px !important;",
      "  box-sizing: border-box !important;",
      "  border-radius: 9px !important;",
      "  background: rgba(255, 255, 255, 0.06) !important;",
      "  border: 1px solid rgba(255, 255, 255, 0.1) !important;",
      "  min-height: 48px !important;",
      "  gap: 8px !important;",
      "}",
      ".hidden-1wt4h8m[data-framer-name='Free plan usage'],",
      ".hidden-1wt4h8m[data-framer-name='Profile'] {",
      "  display: flex !important;",
      "}",
      ".cluezy-sidebar-logout-btn {",
      "  background: rgba(220, 53, 69, 0.15) !important;",
      "  border: 1px solid rgba(220, 53, 69, 0.35) !important;",
      "  color: #ff9b9b !important;",
      "  border-radius: 6px !important;",
      "  padding: 4px 7px !important;",
      "  cursor: pointer !important;",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  gap: 4px !important;",
      "  font-family: 'Inter', -apple-system, sans-serif !important;",
      "  font-size: 11px !important;",
      "  font-weight: 600 !important;",
      "  transition: all 0.15s ease !important;",
      "  flex-shrink: 0 !important;",
      "  margin-left: auto !important;",
      "}",
      ".cluezy-sidebar-logout-btn:hover {",
      "  background: rgba(220, 53, 69, 0.35) !important;",
      "  color: #ffffff !important;",
      "  border-color: rgba(220, 53, 69, 0.7) !important;",
      "}",
      ".cluezy-nav-logout-btn {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 10px !important;",
      "  padding: 8px 12px !important;",
      "  border-radius: 8px !important;",
      "  color: #ff9b9b !important;",
      "  background: rgba(220, 53, 69, 0.12) !important;",
      "  border: 1px solid rgba(220, 53, 69, 0.28) !important;",
      "  text-decoration: none !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 13px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  margin-top: 8px !important;",
      "  transition: all 0.15s ease !important;",
      "  width: 100% !important;",
      "  box-sizing: border-box !important;",
      "}",
      ".cluezy-nav-logout-btn:hover {",
      "  background: rgba(220, 53, 69, 0.28) !important;",
      "  color: #ffffff !important;",
      "  border-color: rgba(220, 53, 69, 0.6) !important;",
      "}",
      ".cluezy-nav-logout-btn:hover p,",
      ".cluezy-nav-logout-btn:hover span {",
      "  color: #ffffff !important;",
      "  --framer-text-color: #ffffff !important;",
      "}",
      ".cluezy-sidebar-signin-btn {",
      "  background: #ffffff !important;",
      "  border: 1px solid #dfe5de !important;",
      "  color: #17251f !important;",
      "  border-radius: 6px !important;",
      "  padding: 7px 10px !important;",
      "  cursor: pointer !important;",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  gap: 6px !important;",
      "  font-family: 'Inter', -apple-system, sans-serif !important;",
      "  font-size: 12px !important;",
      "  font-weight: 600 !important;",
      "  width: 100% !important;",
      "  box-sizing: border-box !important;",
      "  transition: background 0.15s ease !important;",
      "}",
      ".cluezy-sidebar-signin-btn:hover {",
      "  background: #f0f4f1 !important;",
      "}",
      "/* Main content stretch - eliminate 1200px limit & empty margins */",
      ".framer-xyKMK.framer-ypbln3,",
      ".framer-BxVAd.framer-1g3woon,",
      ".framer-EQe3b.framer-3ap5fj,",
      ".framer-fnZmG.framer-1remmab,",
      "[data-framer-root] {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  flex: 1 1 auto !important;",
      "  margin: 0 !important;",
      "  padding: 0 !important;",
      "  box-sizing: border-box !important;",
      "  overflow: hidden !important;",
      "  background-color: #ffffff !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "}",
      "[data-framer-name='investigation content'],",
      "[data-framer-name='solution content'],",
      "[data-framer-name='resolved content'],",
      ".framer-xyKMK .framer-nbz4r4 {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  padding: 16px 28px 16px 28px !important;",
      "  margin: 0 !important;",
      "  box-sizing: border-box !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 12px !important;",
      "  overflow: hidden !important;",
      "}",
      "[data-framer-name='Investigation heading'],",
      ".framer-xyKMK .framer-1yyitid {",
      "  width: 100% !important;",
      "  display: flex !important;",
      "  flex-direction: row !important;",
      "  justify-content: space-between !important;",
      "  align-items: center !important;",
      "  flex: none !important;",
      "  margin-bottom: 2px !important;",
      "}",
      ".cluezy-heading-actions {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 12px !important;",
      "  margin-left: auto !important;",
      "  flex-shrink: 0 !important;",
      "}",
      ".cluezy-header-auth-pill {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 8px !important;",
      "  background: var(--token-gMr3EOQJF, #f5f6f3) !important;",
      "  border: 1px solid var(--token-CrOEkw8uh, #dfe5de) !important;",
      "  border-radius: 20px !important;",
      "  padding: 4px 10px 4px 6px !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 12px !important;",
      "  color: var(--token-vfjxZCpBY, #17251f) !important;",
      "}",
      ".cluezy-header-avatar {",
      "  width: 22px !important;",
      "  height: 22px !important;",
      "  border-radius: 50% !important;",
      "  object-fit: cover !important;",
      "}",
      ".cluezy-header-avatar-initial {",
      "  width: 22px !important;",
      "  height: 22px !important;",
      "  border-radius: 50% !important;",
      "  background: var(--token-aW35IeuAs, #145c38) !important;",
      "  color: #ffffff !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  font-size: 11px !important;",
      "  font-weight: 700 !important;",
      "}",
      ".cluezy-header-user-name {",
      "  font-weight: 600 !important;",
      "  max-width: 130px !important;",
      "  white-space: nowrap !important;",
      "  overflow: hidden !important;",
      "  text-overflow: ellipsis !important;",
      "}",
      ".cluezy-header-logout-btn {",
      "  background: transparent !important;",
      "  border: none !important;",
      "  color: #c93b3b !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 11.5px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  padding: 2px 6px !important;",
      "  border-radius: 4px !important;",
      "  transition: background 0.15s ease !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 4px !important;",
      "}",
      ".cluezy-header-logout-btn:hover {",
      "  background: rgba(201, 59, 59, 0.12) !important;",
      "}",
      ".cluezy-header-signin-btn {",
      "  background: var(--token-aW35IeuAs, #145c38) !important;",
      "  color: #ffffff !important;",
      "  border: none !important;",
      "  border-radius: 20px !important;",
      "  padding: 5px 12px !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 12px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 6px !important;",
      "  transition: opacity 0.15s ease !important;",
      "}",
      ".cluezy-header-signin-btn:hover {",
      "  opacity: 0.9 !important;",
      "}",
      "[data-framer-name='Conversation and context'],",
      ".framer-xyKMK .framer-1voc2cp {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  flex: 1 1 0px !important;",
      "  min-height: 0 !important;",
      "  height: 100% !important;",
      "  display: flex !important;",
      "  flex-direction: row !important;",
      "  gap: 22px !important;",
      "  align-items: stretch !important;",
      "  overflow: hidden !important;",
      "}",
      "/* Conversation chat column takes remaining space */",
      "[data-framer-name='Conversation'],",
      ".framer-xyKMK .framer-1f6swql {",
      "  flex: 1 1 0px !important;",
      "  min-width: 0 !important;",
      "  width: auto !important;",
      "  height: 100% !important;",
      "  max-height: 100% !important;",
      "  overflow-y: auto !important;",
      "  overflow-x: hidden !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  padding-right: 10px !important;",
      "  gap: 16px !important;",
      "  scroll-behavior: smooth;",
      "}",
      "/* Right-hand Investigation context card */",
      "[data-framer-name='Investigation context'],",
      ".framer-xyKMK .framer-1qpwm9z {",
      "  width: 320px !important;",
      "  min-width: 320px !important;",
      "  max-width: 320px !important;",
      "  flex: 0 0 320px !important;",
      "  height: 100% !important;",
      "  max-height: 100% !important;",
      "  overflow-y: auto !important;",
      "  overflow-x: hidden !important;",
      "  background-color: #ffffff !important;",
      "  border: 1px solid var(--token-CrOEkw8uh, #dfe5de) !important;",
      "  border-radius: 14px !important;",
      "  box-sizing: border-box !important;",
      "  padding: 18px !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 14px !important;",
      "}",
      "/* Message bubbles */",
      ".framer-xyKMK .framer-vu1os6 {",
      "  width: fit-content !important;",
      "  max-width: 80% !important;",
      "  margin-left: auto !important;",
      "  align-self: flex-end !important;",
      "  padding: 14px 18px !important;",
      "  border-radius: 14px 14px 2px 14px !important;",
      "  background-color: var(--token-TpfI9O28F, #ecf6e8) !important;",
      "  border: 1px solid var(--token-CrOEkw8uh, #dfe5de) !important;",
      "  box-sizing: border-box !important;",
      "  word-break: break-word !important;",
      "}",
      ".framer-xyKMK .framer-wvffk8 {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  padding: 18px 20px !important;",
      "  box-sizing: border-box !important;",
      "  border-radius: 14px 14px 14px 2px !important;",
      "  word-break: break-word !important;",
      "}",
      ".framer-xyKMK .framer-e0rgel {",
      "  width: 100% !important;",
      "  display: flex !important;",
      "  flex-wrap: wrap !important;",
      "  gap: 8px !important;",
      "  margin-top: 6px !important;",
      "}",
      "[data-framer-name='Reply composer'],",
      ".framer-xyKMK .framer-sz1ut5 {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  margin-top: auto !important;",
      "  box-sizing: border-box !important;",
      "}",
      "/* Disable Framer pseudo border that detaches and cuts off on scroll */",
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
      "  margin-bottom: 14px;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 10px;",
      "  width: 100%;",
      "  max-width: 680px;",
      "  box-sizing: border-box;",
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
      "  gap: 12px !important;",
      "  background-color: #ffffff !important;",
      "  color: #17251f !important;",
      "  border: 1.5px solid #145c38 !important;",
      "  border-radius: 6px !important;",
      "  padding: 12px 28px !important;",
      "  min-width: 220px !important;",
      "  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;",
      "  font-size: 15px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  box-shadow: 0 2px 6px rgba(20, 92, 56, 0.08) !important;",
      "  transition: all 0.2s ease !important;",
      "  text-decoration: none !important;",
      "  line-height: 1 !important;",
      "  box-sizing: border-box !important;",
      "}",
      ".cluezy-google-btn:hover {",
      "  background-color: #f4f8f5 !important;",
      "  border-color: #0d4227 !important;",
      "  color: #0d4227 !important;",
      "  box-shadow: 0 4px 14px rgba(20, 92, 56, 0.16) !important;",
      "  transform: translateY(-1px) !important;",
      "}",
      ".cluezy-google-btn:active {",
      "  transform: translateY(1px) !important;",
      "}",
      ".cluezy-header-profile-pill {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  gap: 12px !important;",
      "  background-color: #ffffff !important;",
      "  border: 1.5px solid #145c38 !important;",
      "  border-radius: 6px !important;",
      "  padding: 8px 18px 8px 12px !important;",
      "  min-width: 210px !important;",
      "  cursor: pointer !important;",
      "  box-shadow: 0 2px 6px rgba(20, 92, 56, 0.08) !important;",
      "  transition: all 0.2s ease !important;",
      "  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;",
      "  font-size: 14.5px !important;",
      "  font-weight: 600 !important;",
      "  color: #17251f !important;",
      "  user-select: none !important;",
      "}",
      ".cluezy-header-profile-pill:hover {",
      "  border-color: #0d4227 !important;",
      "  background-color: #f4f8f5 !important;",
      "  box-shadow: 0 4px 14px rgba(20, 92, 56, 0.16) !important;",
      "  transform: translateY(-1px) !important;",
      "}",
      ".cluezy-header-avatar {",
      "  width: 30px !important;",
      "  height: 30px !important;",
      "  border-radius: 50% !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  background-color: #e2ede5 !important;",
      "  color: #145c38 !important;",
      "  font-weight: 700 !important;",
      "  font-size: 14px !important;",
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

    renderSidebarLogoutButton();
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
      if (el.closest('[data-framer-name="Sidebar"]') && !el.querySelector(".cluezy-sidebar-brand-img")) {
        var svg = el.querySelector("svg");
        var textContainer = el.querySelector('[data-framer-name="CLUEZY"]');
        if (svg) svg.style.display = "none";
        if (textContainer) textContainer.style.display = "none";
        var wrap = document.createElement("div");
        wrap.className = "cluezy-sidebar-brand-img";
        wrap.style.cssText = "display: flex; align-items: center; gap: 8px;";
        wrap.innerHTML = '<img src="/images/logo.png" alt="CLUEZY" style="height: 28px; width: auto; object-fit: contain; filter: brightness(0) invert(1); flex-shrink: 0;" /><img src="/images/text.png" alt="CLUEZY" style="height: 18px; width: auto; object-fit: contain; filter: brightness(0) invert(1); flex-shrink: 0;" />';
        el.appendChild(wrap);
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

    // Render dedicated Logout button in sidebar navigation
    renderSidebarLogoutButton();
  }

  /**
   * Render a dedicated, unmissable Logout button in the sidebar navigation.
   */
  function renderSidebarLogoutButton() {
    var navs = document.querySelectorAll('[data-framer-name="Workspace navigation"]');
    navs.forEach(function (nav) {
      if (nav.querySelector(".cluezy-nav-logout-btn")) return;
      var logoutLink = document.createElement("a");
      logoutLink.className = "cluezy-nav-logout-btn framer-u8w30";
      logoutLink.href = "#";
      logoutLink.setAttribute("data-framer-name", "Logout");
      logoutLink.title = "Log out of Cluezy";
      logoutLink.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
        '<div style="transform: none;"><p class="framer-text framer-styles-preset-1hewirz" data-styles-preset="Z1BYkLRW1" dir="auto" style="--framer-text-color: #ff9b9b;"><span class="framer-text" style="--framer-text-color: #ff9b9b;">Log Out</span></p></div>';

      bindActionClick(logoutLink, async function () {
        logoutLink.style.opacity = "0.5";
        var textEl = logoutLink.querySelector("span");
        if (textEl) textEl.textContent = "Logging out...";
        try {
          await API.signOut();
        } catch (_e) {}
        try {
          localStorage.removeItem("cluezy_anonymous_session_token");
          localStorage.removeItem("cluezy_anonymous_session_id");
          localStorage.removeItem("sb-" + API.SUPABASE_PROJECT_ID + "-auth-token");
        } catch (_e) {}
        window.location.href = "/";
      });
      nav.appendChild(logoutLink);
    });
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
   * with an explicit Logout button, or a clean "Sign in with Google" button for anonymous visitors.
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

      profileEl.style.display = "flex";

      if (user) {
        // Authenticated user state: show compact profile card + explicit Logout button
        var metadata = user.user_metadata || {};
        var displayName = metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "Aditi");
        var avatarUrl = metadata.avatar_url || metadata.picture || null;
        var email = user.email || "Google Account";
        var initial = (displayName.charAt(0) || "A").toUpperCase();

        var avatarHtml = avatarUrl
          ? '<img src="' + avatarUrl + '" alt="' + escapeHtml(displayName) + '" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" referrerpolicy="no-referrer" />'
          : '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-weight: 700; color: #ffffff; background: #145c38; border-radius: 50%; font-size: 13px;">' + initial + '</div>';

        profileEl.innerHTML =
          '<div class="cluezy-profile-card-inner" style="display: flex; align-items: center; gap: 8px; flex: 1 1 0px; min-width: 0; cursor: pointer;" title="Account details">' +
            '<div style="width: 28px; height: 28px; min-width: 28px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center;">' +
              avatarHtml +
            '</div>' +
            '<div style="flex: 1 1 0px; min-width: 0; display: flex; flex-direction: column; justify-content: center;">' +
              '<div style="font-weight: 600; font-size: 12px; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">' + escapeHtml(displayName) + '</div>' +
              '<div style="font-size: 10.5px; color: #9bb5a3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; margin-top: 2px;">' + escapeHtml(email) + '</div>' +
            '</div>' +
          '</div>' +
          '<button class="cluezy-sidebar-logout-btn" title="Log out" aria-label="Log out" type="button">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
              '<polyline points="16 17 21 12 16 7"></polyline>' +
              '<line x1="21" y1="12" x2="9" y2="12"></line>' +
            '</svg>' +
            '<span>Logout</span>' +
          '</button>';

        var cardInner = profileEl.querySelector(".cluezy-profile-card-inner");
        if (cardInner) {
          cardInner.onclick = function (e) {
            e.stopPropagation();
            toggleAccountDropdown(profileEl, user);
          };
        }

        var logoutBtn = profileEl.querySelector(".cluezy-sidebar-logout-btn");
        if (logoutBtn) {
          logoutBtn.onclick = async function (e) {
            e.stopPropagation();
            logoutBtn.disabled = true;
            logoutBtn.innerHTML = '<span>...</span>';
            try {
              await API.signOut();
            } catch (_e) {}
            bindUserProfile();
            var invRoot = document.querySelector('[data-framer-name="investigation content"]');
            if (invRoot) renderInvestigationHeadingAuth(invRoot);
            API.listInvestigations({ page: 1, page_size: 5 })
              .then(function (res) {
                if (res && Array.isArray(res.items)) {
                  renderSidebarRecentInvestigations(res.items);
                }
              })
              .catch(function () {});
          };
        }
      } else {
        // Unauthenticated anonymous state: Show clean Google Sign-In button
        profileEl.innerHTML =
          '<button class="cluezy-sidebar-signin-btn" title="Sign in with Google" type="button">' +
            '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.8s.7 5.1 1.9 7.5l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.4 7.5 23 12 23z"/></svg>' +
            '<span>Sign in with Google</span>' +
          '</button>';

        var signinBtn = profileEl.querySelector(".cluezy-sidebar-signin-btn");
        if (signinBtn) {
          signinBtn.onclick = function (e) {
            e.stopPropagation();
            API.signInWithGoogle();
          };
        }
      }
    });

    var invRoot = document.querySelector('[data-framer-name="investigation content"]');
    if (invRoot) {
      renderInvestigationHeadingAuth(invRoot);
    }
  }

  /**
   * Render or update the small profile / logout indicator in the Investigation header bar.
   */
  async function renderInvestigationHeadingAuth(root) {
    if (!root) return;
    var headingEl = root.querySelector('[data-framer-name="Investigation heading"]');
    if (!headingEl) return;

    var statusBadge = headingEl.querySelector('[data-framer-name="Status Active"]');
    var actionsContainer = headingEl.querySelector(".cluezy-heading-actions");
    if (!actionsContainer) {
      actionsContainer = document.createElement("div");
      actionsContainer.className = "cluezy-heading-actions";
      if (statusBadge) {
        headingEl.appendChild(actionsContainer);
        actionsContainer.appendChild(statusBadge);
      } else {
        headingEl.appendChild(actionsContainer);
      }
    }

    var authSlot = actionsContainer.querySelector(".cluezy-header-auth-slot");
    if (!authSlot) {
      authSlot = document.createElement("div");
      authSlot.className = "cluezy-header-auth-slot";
      actionsContainer.appendChild(authSlot);
    }

    var user = null;
    try {
      user = await API.getAuthUser();
    } catch (_e) {
      user = null;
    }

    if (user) {
      var metadata = user.user_metadata || {};
      var displayName = metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "User");
      var avatarUrl = metadata.avatar_url || metadata.picture || null;
      var initial = (displayName.charAt(0) || "U").toUpperCase();
      var avatarHtml = avatarUrl
        ? '<img class="cluezy-header-avatar" src="' + avatarUrl + '" alt="' + escapeHtml(displayName) + '" referrerpolicy="no-referrer" />'
        : '<div class="cluezy-header-avatar-initial">' + escapeHtml(initial) + '</div>';

      authSlot.innerHTML =
        '<div class="cluezy-header-auth-pill">' +
          avatarHtml +
          '<span class="cluezy-header-user-name">' + escapeHtml(displayName) + '</span>' +
          '<button class="cluezy-header-logout-btn" title="Log out" type="button">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
              '<polyline points="16 17 21 12 16 7"></polyline>' +
              '<line x1="21" y1="12" x2="9" y2="12"></line>' +
            '</svg>' +
            '<span>Logout</span>' +
          '</button>' +
        '</div>';

      var logoutBtn = authSlot.querySelector(".cluezy-header-logout-btn");
      if (logoutBtn) {
        logoutBtn.onclick = async function (e) {
          e.stopPropagation();
          logoutBtn.disabled = true;
          logoutBtn.innerHTML = "<span>...</span>";
          try {
            await API.signOut();
          } catch (_e) {}
          bindUserProfile();
          renderInvestigationHeadingAuth(root);
          API.listInvestigations({ page: 1, page_size: 5 })
            .then(function (res) {
              if (res && Array.isArray(res.items)) {
                renderSidebarRecentInvestigations(res.items);
              }
            })
            .catch(function () {});
        };
      }
    } else {
      authSlot.innerHTML =
        '<div style="display: flex; align-items: center; gap: 8px;">' +
          '<button class="cluezy-header-signin-btn" title="Sign in with Google" type="button">' +
            '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.8s.7 5.1 1.9 7.5l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.4 7.5 23 12 23z"/></svg>' +
            '<span>Sign In</span>' +
          '</button>' +
          '<button class="cluezy-header-logout-btn" title="Log out / Exit" type="button" style="border: 1px solid rgba(220,53,69,0.3); background: rgba(220,53,69,0.08); padding: 5px 10px; border-radius: 6px;">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
              '<polyline points="16 17 21 12 16 7"></polyline>' +
              '<line x1="21" y1="12" x2="9" y2="12"></line>' +
            '</svg>' +
            '<span>Logout</span>' +
          '</button>' +
        '</div>';

      var signinBtn = authSlot.querySelector(".cluezy-header-signin-btn");
      if (signinBtn) {
        signinBtn.onclick = function (e) {
          e.stopPropagation();
          API.signInWithGoogle();
        };
      }
      var headerLogoutBtn = authSlot.querySelector(".cluezy-header-logout-btn");
      if (headerLogoutBtn) {
        headerLogoutBtn.onclick = async function (e) {
          e.stopPropagation();
          headerLogoutBtn.disabled = true;
          headerLogoutBtn.innerHTML = "<span>...</span>";
          try {
            await API.signOut();
          } catch (_e) {}
          try {
            localStorage.removeItem("cluezy_anonymous_session_token");
            localStorage.removeItem("cluezy_anonymous_session_id");
          } catch (_e) {}
          window.location.href = "/";
        };
      }
    }
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

  var STARTER_CATEGORIES = [
    { id: "all", label: "🌟 Popular" },
    { id: "network", label: "🌐 Network & Wi-Fi" },
    { id: "hardware", label: "💻 Hardware & System" },
    { id: "audio", label: "🎙️ Audio & Video" },
    { id: "software", label: "⚡ Software & Apps" },
    { id: "dev", label: "🗄️ Dev & Database" },
  ];

  var STARTER_PROMPTS_BY_CATEGORY = {
    all: [
      {
        label: "Wi-Fi connected but websites won't open (phone works)",
        prompt:
          "My Windows laptop is connected to Wi-Fi but websites aren't opening, though my phone works fine on the same network.",
      },
      {
        label: "Zoom / Teams does not recognize USB microphone",
        prompt:
          "Zoom says no microphone detected, but my USB microphone is plugged in and works in other apps.",
      },
      {
        label: "Laptop freezing randomly with 100% Disk / CPU usage",
        prompt:
          "My laptop keeps freezing and Task Manager shows 100% disk and CPU usage even when no apps are running.",
      },
      {
        label: "PostgreSQL connection refused: ECONNREFUSED on port 5432",
        prompt:
          "My backend application cannot connect to the PostgreSQL database, showing connection refused on 127.0.0.1:5432.",
      },
    ],
    network: [
      {
        label: "Wi-Fi says No Internet (IPv4 starts with 169.254 APIPA)",
        prompt:
          "My Windows laptop is connected to Wi-Fi with no internet access. I ran ipconfig and my IPv4 address starts with 169.254.",
      },
      {
        label: "DNS server not responding on Windows / Mac",
        prompt:
          "Websites won't load and Windows network troubleshooter reports 'Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding'.",
      },
      {
        label: "All devices on Wi-Fi have no internet access",
        prompt:
          "My laptop and all other devices and phones on the Wi-Fi have no internet. The router lights are blinking amber/orange.",
      },
      {
        label: "Ethernet connected but says Unidentified Network",
        prompt:
          "My PC is plugged in via Ethernet cable, but Windows shows 'Unidentified Network - No Internet Access'.",
      },
    ],
    hardware: [
      {
        label: "Laptop shuts down automatically when running heavy apps",
        prompt:
          "My laptop suddenly shuts off without warning when gaming or running intensive applications. The bottom fan feels extremely hot.",
      },
      {
        label: "External monitor not detected over HDMI / USB-C",
        prompt:
          "Windows Display Settings says 'Didn't detect another display' when plugging in my external monitor via HDMI.",
      },
      {
        label: "Laptop battery draining fast even in sleep mode",
        prompt:
          "My laptop battery drops 40% overnight even when the lid is closed and the computer is in sleep mode.",
      },
      {
        label: "High memory / RAM usage causing system freeze",
        prompt:
          "Task Manager shows 95% RAM in use even with only a few browser tabs open, causing the entire computer to lag.",
      },
    ],
    audio: [
      {
        label: "Zoom / Teams says 'No microphone detected'",
        prompt:
          "During Zoom meetings, the microphone is muted and settings say 'Cannot detect your microphone' even though permissions are granted.",
      },
      {
        label: "Bluetooth headphones paired but audio plays through speakers",
        prompt:
          "My Bluetooth headphones are connected in Windows settings, but audio still comes out of the laptop speakers.",
      },
      {
        label: "Microphone volume is extremely low or muffled",
        prompt:
          "Other people in Discord and Google Meet can barely hear me because my microphone volume is too low despite max volume in settings.",
      },
      {
        label: "USB audio device not recognized (Device Descriptor Failed)",
        prompt:
          "When plugging in my USB headset/mic, Windows says 'USB device not recognized (Device Descriptor Request Failed)'.",
      },
    ],
    software: [
      {
        label: "Application crashes immediately on launch with no error",
        prompt:
          "When I click to open my application, the loading spinner appears for two seconds and then disappears without opening or showing an error.",
      },
      {
        label: "Software installer fails with error 2503 / 2502",
        prompt:
          "Running the installer fails with 'The installer has encountered an unexpected error installing this package. Code 2503 / 2502'.",
      },
      {
        label: "Windows Update stuck downloading or installing at 100%",
        prompt:
          "Windows Update has been stuck at 100% installing for over two hours and restarting doesn't fix it.",
      },
      {
        label: "Browser shows ERR_CONNECTION_REFUSED on all pages",
        prompt:
          "Every website I try to open in Chrome shows ERR_CONNECTION_REFUSED, even after clearing cache and cookies.",
      },
    ],
    dev: [
      {
        label: "Database connection refused: 127.0.0.1:5432",
        prompt:
          "My local development server cannot connect to PostgreSQL on port 5432, throwing ECONNREFUSED.",
      },
      {
        label: "Port 3000 / 8080 already in use by another process",
        prompt:
          "Running npm run dev fails with 'Error: listen EADDRINUSE: address already in use :::3000'.",
      },
      {
        label: "Git push rejected (non-fast-forward / merge conflict)",
        prompt:
          "Git push origin main is rejected with 'error: failed to push some refs ... Updates were rejected because the remote contains work'.",
      },
      {
        label: "Docker daemon not running / cannot connect to docker.sock",
        prompt:
          "Docker CLI returns 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'",
      },
    ],
  };

  /**
   * Helper to visually update the send button state based on text length and submission status.
   */
  function updateSendButtonVisual(ta, btn) {
    if (!btn) return;
    var hasText = ta && ta.value && ta.value.trim().length > 0;
    if (appState.isSubmitting) {
      btn.style.opacity = "0.5";
      btn.style.cursor = "wait";
    } else if (hasText) {
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.style.backgroundColor = "var(--token-aW35IeuAs, #145c38)";
    } else {
      btn.style.opacity = "0.5";
      btn.style.cursor = "pointer";
    }
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

      // Small profile section and explicit logout button in heading
      renderInvestigationHeadingAuth(root);

      // 2. Ensure Reply Composer has an interactive <textarea>
      var composer = root.querySelector('[data-framer-name="Reply composer"]');
      var replyBox = composer ? composer.querySelector('[data-framer-name="Type your reply..."]') : null;
      var sendBtn = composer
        ? composer.querySelector('[data-framer-name="Send reply"], [data-framer-name="Send"], a[data-framer-name*="Send"]')
        : null;
      var textarea = replyBox ? replyBox.querySelector("textarea.cluezy-chat-textarea") : null;

      if (composer) {
        composer.classList.add("cluezy-input-bar-enhanced");

        // Paperclip attachment handling
        var paperclip = composer.querySelector('[data-framer-name="Paperclip"], svg');
        if (paperclip && !paperclip.dataset.bound) {
          paperclip.dataset.bound = "true";
          paperclip.style.cursor = "pointer";
          paperclip.setAttribute("title", "Attach log, error screenshot, or system info");
          var fileInp = document.getElementById("cluezy-composer-file-input");
          if (!fileInp) {
            fileInp = document.createElement("input");
            fileInp.type = "file";
            fileInp.id = "cluezy-composer-file-input";
            fileInp.style.display = "none";
            fileInp.accept = ".txt,.log,.json,.csv,image/*";
            document.body.appendChild(fileInp);
            fileInp.addEventListener("change", function () {
              if (fileInp.files && fileInp.files[0]) {
                var file = fileInp.files[0];
                var ta = composer.querySelector("textarea.cluezy-chat-textarea");
                if (ta) {
                  var note = "[Attached: " + file.name + " (" + Math.round(file.size / 1024) + " KB)]\n";
                  ta.value = note + (ta.value || "");
                  autoResizeChatTextarea(ta);
                  updateSendButtonVisual(ta, sendBtn);
                  ta.focus();
                }
              }
            });
          }
          paperclip.addEventListener("click", function (e) {
            e.preventDefault();
            fileInp.click();
          });
        }
      }

      if (replyBox && !textarea) {
        replyBox.innerHTML = "";
        textarea = document.createElement("textarea");
        textarea.className = "cluezy-chat-textarea";
        textarea.rows = 1;
        textarea.placeholder = inv
          ? "Type your reply or test result (Enter to send, Shift+Enter for newline)…"
          : "Describe your technical issue in detail (e.g., laptop shuts down, Wi-Fi no internet, app crash)…";
        textarea.setAttribute("aria-label", "Message input");

        textarea.addEventListener("input", function () {
          autoResizeChatTextarea(textarea);
          updateSendButtonVisual(textarea, sendBtn);
        });

        textarea.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleComposerSubmit(textarea);
          }
        });
        replyBox.appendChild(textarea);
        autoResizeChatTextarea(textarea);
        updateSendButtonVisual(textarea, sendBtn);
      } else if (textarea) {
        textarea.placeholder = inv
          ? "Type your reply or test result (Enter to send, Shift+Enter for newline)…"
          : "Describe your technical issue in detail (e.g., laptop shuts down, Wi-Fi no internet, app crash)…";
        textarea.disabled = appState.isSubmitting;
        autoResizeChatTextarea(textarea);
        updateSendButtonVisual(textarea, sendBtn);
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
          convContainer.insertBefore(errBanner, convContainer.firstChild);
        }

        var isNewInvestigation = !inv || !Array.isArray(inv.messages) || inv.messages.length === 0;

        if (isNewInvestigation) {
          // Centered Middle Layout for New Investigation
          convContainer.classList.add("cluezy-new-investigation-layout");

          // 1. Hero welcome section
          var heroSection = document.createElement("div");
          heroSection.className = "cluezy-hero-welcome-section";
          heroSection.innerHTML =
            '<div class="cluezy-hero-badge">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>' +
              'AI Diagnostic Assistant' +
            '</div>' +
            '<h1 class="cluezy-hero-title">Describe your technical problem</h1>' +
            '<p class="cluezy-hero-subtitle">Type your issue below or choose a scenario to start a step-by-step diagnostic investigation.</p>';
          convContainer.appendChild(heroSection);

          // 2. Reply composer placed in the middle
          if (composer) {
            convContainer.appendChild(composer);
          }

          // 3. Category Filter Pills
          var categoriesContainer = document.createElement("div");
          categoriesContainer.className = "cluezy-starter-categories";
          var currentCategory = appState.selectedStarterCategory || "all";
          STARTER_CATEGORIES.forEach(function (cat) {
            var pill = document.createElement("button");
            pill.type = "button";
            pill.className = "cluezy-category-pill" + (cat.id === currentCategory ? " active" : "");
            pill.textContent = cat.label;
            pill.addEventListener("click", function () {
              appState.selectedStarterCategory = cat.id;
              renderInvestigationView();
            });
            categoriesContainer.appendChild(pill);
          });
          convContainer.appendChild(categoriesContainer);

          // 4. Starter suggestions for active category
          answersContainer.innerHTML = "";
          var prompts = STARTER_PROMPTS_BY_CATEGORY[currentCategory] || STARTER_PROMPTS_BY_CATEGORY["all"];
          prompts.forEach(function (sp) {
            var card = document.createElement("a");
            card.href = "javascript:void(0)";
            card.className = "cluezy-starter-card";
            card.innerHTML =
              '<span class="cluezy-starter-card-label">' + escapeHtml(sp.label) + '</span>' +
              '<span class="cluezy-starter-card-arrow">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>' +
              '</span>';
            bindActionClick(card, function (e) {
              if (e) e.preventDefault();
              startNewInvestigation(sp.prompt);
            });
            answersContainer.appendChild(card);
          });
          convContainer.appendChild(answersContainer);

          if (appState.isSubmitting) {
            var loadingBubble = createChatBubbleDOM(
              "assistant",
              "Analyzing evidence and evaluating diagnostic rules…",
              "Working…"
            );
            loadingBubble.classList.add("cluezy-typing-indicator");
            convContainer.appendChild(loadingBubble);
          }
        } else {
          // Active Investigation Conversation Mode
          convContainer.classList.remove("cluezy-new-investigation-layout");

          inv.messages.forEach(function (msg) {
            var bubble = createChatBubbleDOM(msg.sender, msg.content || msg.text || "", formatTime(msg.created_at));
            convContainer.appendChild(bubble);
          });

          if (appState.isSubmitting) {
            var activeLoadingBubble = createChatBubbleDOM(
              "assistant",
              "Analyzing evidence and evaluating diagnostic rules…",
              "Working…"
            );
            activeLoadingBubble.classList.add("cluezy-typing-indicator");
            convContainer.appendChild(activeLoadingBubble);
          }

          // Populate quick-reply buttons from latest assistant message
          answersContainer.innerHTML = "";
          var lastAssistantMsg = null;
          for (var i = inv.messages.length - 1; i >= 0; i--) {
            if (inv.messages[i].sender === "assistant") {
              lastAssistantMsg = inv.messages[i];
              break;
            }
          }
          var suggestions =
            lastAssistantMsg && Array.isArray(lastAssistantMsg.suggested_responses) && lastAssistantMsg.suggested_responses.length > 0
              ? lastAssistantMsg.suggested_responses
              : lastAssistantMsg && lastAssistantMsg.extra_data && Array.isArray(lastAssistantMsg.extra_data.quick_replies)
              ? lastAssistantMsg.extra_data.quick_replies
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

          if (answersContainer.children.length > 0) {
            convContainer.appendChild(answersContainer);
          }

          // Pin composer at bottom
          if (composer) {
            convContainer.appendChild(composer);
          }

          // Auto-scroll conversation to bottom
          convContainer.scrollTop = convContainer.scrollHeight;
        }
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
    var sidebars = root.querySelectorAll(
      '[data-framer-name="Investigation context"], [data-framer-name="Investigation Context"]'
    );
    if (!sidebars || sidebars.length === 0) return;

    sidebars.forEach(function (sidebar) {
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
        sidebar.querySelector('[data-framer-name="Investigation context"]'),
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
    });
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

    var inv = appState.currentInvestigation;
    var isNew =
      !inv ||
      !Array.isArray(inv.messages) ||
      inv.messages.length === 0 ||
      inv.status === "resolved";

    if (isNew) {
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

    try {
      renderInvestigationView();
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

    appState.isSubmitting = true;
    appState.errorBannerMessage = null;

    try {
      renderInvestigationView();
      var created = await API.createInvestigation(text);
      if (textareaToRestore) {
        textareaToRestore.value = "";
        autoResizeChatTextarea(textareaToRestore);
      }
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

        if (targetId) {
          try {
            var inv = await API.getInvestigation(targetId);
            // If the investigation is already resolved and user didn't explicitly request it by ?id=, start fresh
            if (inv && inv.status === "resolved" && !urlId) {
              API.setCurrentInvestigationId(null);
              appState.currentInvestigation = null;
            } else {
              appState.currentInvestigation = inv;
              API.setCurrentInvestigationId(inv.reference_id);
            }
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

