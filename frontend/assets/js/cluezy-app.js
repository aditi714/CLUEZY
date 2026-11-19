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
      "  min-height: 22px;",
      "  max-height: 90px;",
      "  border: none;",
      "  outline: none;",
      "  background: transparent;",
      "  font-family: 'Inter', 'Inter Placeholder', sans-serif;",
      "  font-size: 13px;",
      "  line-height: 1.5;",
      "  color: var(--token-vfjxZCpBY, #17251f);",
      "  resize: none;",
      "  padding: 0;",
      "  margin: 0;",
      "  display: block;",
      "}",
      ".cluezy-chat-textarea::placeholder {",
      "  color: var(--token-z7x8e0_dE, #58655e);",
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
      "[data-framer-name='Conversation'] {",
      "  overflow-y: auto !important;",
      "  max-height: 540px;",
      "  scroll-behavior: smooth;",
      "}",
      "[data-framer-name='Investigation context'] {",
      "  overflow-y: auto !important;",
      "  max-height: 640px;",
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

    var kbLinks = document.querySelectorAll('[data-framer-name="Sidebar"] [data-framer-name="Knowledge Base"]');
    kbLinks.forEach(function (el) {
      var anchor = el.tagName === "A" ? el : el.closest("a");
      if (anchor) {
        bindActionClick(anchor, function () {
          navigateTo("/knowledge-base/");
        });
      }
    });

    var savedFixesLinks = document.querySelectorAll('[data-framer-name="Sidebar"] [data-framer-name="Saved Fixes"]');
    savedFixesLinks.forEach(function (el) {
      var anchor = el.tagName === "A" ? el : el.closest("a");
      if (anchor) {
        bindActionClick(anchor, function () {
          navigateTo("/investigations/", { filter: "resolved" });
        });
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

      // Bind "Start Troubleshooting" & "Get Started" buttons
      var startBtns = document.querySelectorAll(
        '[data-framer-name="Start Troubleshooting"] a, [data-framer-name="Get Started"] a'
      );
      startBtns.forEach(function (a) {
        bindActionClick(a, function () {
          var heroInp = document.querySelector(".cluezy-hero-input");
          if (heroInp && heroInp.value.trim()) {
            API.setDraftProblem(heroInp.value.trim());
          }
          API.setCurrentInvestigationId(null);
          navigateTo("/investigation/", { new: "1" });
        });
      });

      // Bind "Sign In" -> My Investigations
      var signInBtns = document.querySelectorAll('[data-framer-name="Sign In"] a');
      signInBtns.forEach(function (a) {
        bindActionClick(a, function () {
          navigateTo("/investigations/");
        });
      });

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
    a.className = "framer-6VCSX framer-ntMaH framer-9jeig7 framer-v-9jeig7 framer-tkxn9d";
    a.setAttribute("data-border", "true");
    a.setAttribute("data-framer-name", "Default");
    a.setAttribute("href", "#");
    a.setAttribute("role", "button");
    a.style.cssText =
      "--border-bottom-width: 1px; --border-color: var(--token-aW35IeuAs); --border-left-width: 1px; " +
      "--border-right-width: 1px; --border-style: solid; --border-top-width: 1px; border-radius: 9px; opacity: 1; " +
      (isPrimary ? "background-color: rgb(20, 92, 56);" : "background-color: rgb(252, 251, 249);");

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

        textarea.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleComposerSubmit(textarea);
          }
        });
        replyBox.appendChild(textarea);
      } else if (textarea) {
        textarea.placeholder = inv
          ? "Type your reply or test result (Enter to send, Shift+Enter for newline)…"
          : "Describe your technical issue in detail (e.g., Wi-Fi connected on Windows laptop, websites won't open)…";
        textarea.disabled = appState.isSubmitting;
      }

      if (sendBtn) {
        if (appState.isSubmitting) {
          sendBtn.classList.add("cluezy-disabled");
        } else {
          sendBtn.classList.remove("cluezy-disabled");
        }
        bindActionClick(sendBtn, function () {
          if (textarea) handleComposerSubmit(textarea);
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
          starterPrompts.forEach(function (sp, idx) {
            var btn = createQuickReplyButtonDOM(sp.label, idx === 0, function () {
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

          suggestions.forEach(function (label, idx) {
            var chip = createQuickReplyButtonDOM(label, idx === 0, function () {
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

    var iconSpec = pickEvidenceIconHref(ev);
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", iconSpec.cls);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("role", "presentation");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", iconSpec.href);
    svg.appendChild(use);
    row.appendChild(svg);

    var textDiv = document.createElement("div");
    textDiv.className = "framer-1wzs70";
    textDiv.setAttribute("data-framer-component-type", "RichTextContainer");
    textDiv.style.transform = "none";

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
    row.style.flexWrap = "wrap";

    var leftDiv = document.createElement("div");
    leftDiv.className = "framer-ku9eke";
    leftDiv.setAttribute("data-framer-component-type", "RichTextContainer");
    leftDiv.style.transform = "none";
    leftDiv.style.flex = "1 1 65%";

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
    appState.isSubmitting = true;
    appState.errorBannerMessage = null;
    renderInvestigationView();

    try {
      var updated = await API.submitMessage(inv.reference_id, savedDraft, qId);
      appState.currentInvestigation = updated;
    } catch (err) {
      // Restore user draft so it is never lost on network/API failure
      textarea.value = savedDraft;
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

      // 2. Interactive Status Filter Button
      var statusFilterBtn = root.querySelector('[data-framer-name="Status All Status"]');
      if (statusFilterBtn) {
        var filterSpan = statusFilterBtn.querySelector("span, p");
        var labelMap = {
          all: "All Status",
          active: "Active / In Progress",
          resolved: "Resolved",
        };
        if (filterSpan) {
          filterSpan.textContent = labelMap[appState.statusFilter] || "All Status";
        }
        bindActionClick(statusFilterBtn, function () {
          var order = ["all", "active", "resolved"];
          var nextIdx = (order.indexOf(appState.statusFilter) + 1) % order.length;
          appState.statusFilter = order[nextIdx];
          renderInvestigationsListView();
        });
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
      await API.getOrCreateSession(false);

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
        return;
      }

      if (isInvestigationPage || isSolutionPage || isResolvedPage) {
        var draft = API.getDraftProblem();
        if (isInvestigationPage && draft && draft.trim().length >= 5) {
          API.setDraftProblem(null);
          await startNewInvestigation(draft);
          return;
        }

        var targetId = !isExplicitNew ? API.getCurrentInvestigationId() : null;
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
    if (invEl) {
      renderInvestigationView();
    }

    var solEl = document.querySelector('[data-framer-name="solution content"]');
    if (solEl) {
      renderSolutionView();
    }

    var resEl = document.querySelector('[data-framer-name="resolved content"]');
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

        var myInvBtn = target.closest(
          '[data-framer-name="My Investigations"], [data-framer-name="Sign In"]'
        );
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

