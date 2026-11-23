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
    // Voice preferences and active states
    voiceLang: (function () {
      try {
        return localStorage.getItem("cluezy_voice_lang") || sessionStorage.getItem("cluezy_voice_lang") || "en-IN";
      } catch (_e) {
        return "en-IN";
      }
    })(),
    voiceSpeakerEnabled: (function () {
      try {
        var ls = localStorage.getItem("cluezy_read_aloud_enabled");
        if (ls !== null) return ls === "true";
        return sessionStorage.getItem("cluezy_voice_speaker") === "true";
      } catch (_e) {
        return false;
      }
    })(),
    preferredVoiceURI: (function () {
      try {
        return localStorage.getItem("cluezy_preferred_voice_uri") || "";
      } catch (_e) {
        return "";
      }
    })(),
    isRecording: false,
    speechErrorMessage: null,
    lastSpokenMessageId: null,
    solutionActiveStepIndex: 0,
    checkedChecklistKeys: {},
  };

  // ============================================================================
  // WEB SPEECH API CONTROLLER (SpeechRecognition & SpeechSynthesis)
  // ============================================================================
  var CluezyVoice = (function () {
    var SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    var recognitionInstance = null;
    var baseTextBeforeSpeech = "";
    var currentInterimText = "";
    var speechQueue = [];
    var isQueueSpeaking = false;
    var currentUtteranceEndCallback = null;
    var chunkPauseTimer = null;

    // Term normalization map for common technical terms
    var NORMALIZATION_MAP = [
      { pattern: /\b(?:dns|d\.n\.s\.)\b/gi, replacement: "DNS" },
      { pattern: /\b(?:wi\s*fi|wifi|wyfy)\b/gi, replacement: "Wi-Fi" },
      { pattern: /\b(?:ip\s*address|i\.p\.\s*address)\b/gi, replacement: "IP address" },
      { pattern: /\b(?:ip|i\.p\.)\b/gi, replacement: "IP" },
      { pattern: /\b(?:ping|peeng)\b/gi, replacement: "ping" },
      { pattern: /\b(?:router|rout er)\b/gi, replacement: "router" },
      { pattern: /\b(?:gateway|gate way)\b/gi, replacement: "gateway" },
      { pattern: /\b(?:dhcp|d\.h\.c\.p\.)\b/gi, replacement: "DHCP" },
      { pattern: /\b(?:apipa)\b/gi, replacement: "APIPA" },
      { pattern: /\b(?:wan|w\.a\.n\.)\b/gi, replacement: "WAN" },
      { pattern: /\b(?:lan|l\.a\.n\.)\b/gi, replacement: "LAN" },
      { pattern: /\b(?:icmp)\b/gi, replacement: "ICMP" },
      { pattern: /\b(?:cmd|command\s*prompt)\b/gi, replacement: "Command Prompt" },
      { pattern: /\b(?:ipconfig)\b/gi, replacement: "ipconfig" },
    ];

    function normalizeTranscript(rawText) {
      if (!rawText) return "";
      var text = rawText;
      NORMALIZATION_MAP.forEach(function (rule) {
        text = text.replace(rule.pattern, rule.replacement);
      });
      return text;
    }

    function isRecognitionSupported() {
      return Boolean(SpeechRecognition);
    }

    function isSynthesisSupported() {
      return typeof window !== "undefined" && "speechSynthesis" in window;
    }

    function setLanguage(lang) {
      appState.voiceLang = lang;
      try {
        localStorage.setItem("cluezy_voice_lang", lang);
        sessionStorage.setItem("cluezy_voice_lang", lang);
      } catch (_e) {}
      if (recognitionInstance) {
        recognitionInstance.lang = lang;
      }
    }

    function setSpeakerEnabled(enabled) {
      appState.voiceSpeakerEnabled = Boolean(enabled);
      try {
        localStorage.setItem("cluezy_read_aloud_enabled", String(appState.voiceSpeakerEnabled));
        sessionStorage.setItem("cluezy_voice_speaker", String(appState.voiceSpeakerEnabled));
      } catch (_e) {}
      if (!appState.voiceSpeakerEnabled) {
        stopSpeaking();
      }
    }

    function setPreferredVoiceURI(uri) {
      appState.preferredVoiceURI = uri || "";
      try {
        localStorage.setItem("cluezy_preferred_voice_uri", appState.preferredVoiceURI);
      } catch (_e) {}
    }

    function stopSpeaking() {
      if (chunkPauseTimer) {
        clearTimeout(chunkPauseTimer);
        chunkPauseTimer = null;
      }
      speechQueue = [];
      isQueueSpeaking = false;
      currentUtteranceEndCallback = null;
      if (isSynthesisSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch (_e) {}
      }
    }

    function scoreVoiceQuality(v, targetLang) {
      if (!v) return -100;
      var score = 0;
      var vLang = (v.lang || "").toLowerCase().replace(/_/g, "-");
      var tLow = (targetLang || "en-IN").toLowerCase();
      var prefix = tLow.split("-")[0];

      if (vLang === tLow) score += 50;
      else if (vLang.split("-")[0] === prefix) score += 25;
      else return -50;

      var nameLow = (v.name || "").toLowerCase();
      if (nameLow.indexOf("natural") >= 0) score += 35;
      if (nameLow.indexOf("online") >= 0) score += 25;
      if (nameLow.indexOf("google") >= 0) score += 20;
      if (nameLow.indexOf("neural") >= 0 || nameLow.indexOf("premium") >= 0) score += 15;
      return score;
    }

    function getAvailableVoicesForLang(targetLang) {
      if (!isSynthesisSupported()) return [];
      var allVoices = window.speechSynthesis.getVoices() || [];
      if (!allVoices.length) return [];
      var tLow = (targetLang || appState.voiceLang || "en-IN").toLowerCase();
      var prefix = tLow.split("-")[0];
      var matching = allVoices.filter(function (v) {
        var vl = (v.lang || "").toLowerCase().replace(/_/g, "-");
        return vl === tLow || vl.split("-")[0] === prefix;
      });
      var pool = matching.length > 0 ? matching.slice() : allVoices.slice();
      pool.sort(function (a, b) {
        return scoreVoiceQuality(b, tLow) - scoreVoiceQuality(a, tLow);
      });
      return pool;
    }

    function getVoiceForLang(targetLang) {
      if (!isSynthesisSupported()) return null;
      var allVoices = window.speechSynthesis.getVoices() || [];
      if (!allVoices || allVoices.length === 0) return null;

      var tLow = (targetLang || appState.voiceLang || "en-IN").toLowerCase();
      var prefix = tLow.split("-")[0];

      // 1. Check user-selected preferred voice from localStorage if it matches the language family
      if (appState.preferredVoiceURI) {
        var userChoice = allVoices.find(function (v) {
          return (v.voiceURI === appState.preferredVoiceURI || v.name === appState.preferredVoiceURI) &&
            (v.lang || "").toLowerCase().indexOf(prefix) === 0;
        });
        if (userChoice) return userChoice;
      }

      // 2. Otherwise pick highest-ranked voice preferring Natural / Online / Google
      var ranked = getAvailableVoicesForLang(targetLang);
      return ranked[0] || allVoices[0] || null;
    }

    /**
     * Sanitize text for TTS:
     * - Replace fenced code blocks or terminal command snippets with "I've put the command on screen."
     * - Strip markdown symbols, URLs, and emojis.
     */
    function sanitizeTextForSpeech(rawText) {
      if (!rawText) return "";
      var cmdReplacement =
        appState.voiceLang === "hi-IN"
          ? " मैंने कमांड स्क्रीन पर रख दी है। "
          : " I've put the command on screen. ";

      var text = String(rawText);

      // 1. Replace fenced code blocks ```...```
      var usedCmdNotice = false;
      text = text.replace(/```[\s\S]*?```/g, function () {
        if (!usedCmdNotice) {
          usedCmdNotice = true;
          return cmdReplacement;
        }
        return " ";
      });

      // 2. Replace inline backtick commands (e.g. `ipconfig /flushdns`, `ping 192.168.1.1`)
      text = text.replace(/`([^`]{4,})`/g, function (_match, codeInner) {
        var looksLikeCmd =
          /\b(ipconfig|ping|nslookup|netsh|tracert|traceroute|sudo|systemctl|chmod|docker|git|npm|pip|python|ncpa\.cpl|cmd)\b/i.test(
            codeInner
          ) || /[\/\\=-]{1,2}\w+/.test(codeInner);
        if (looksLikeCmd) {
          if (!usedCmdNotice) {
            usedCmdNotice = true;
            return cmdReplacement;
          }
          return " ";
        }
        return codeInner;
      });

      // 3. Replace single-quoted shell commands in prose (e.g. run 'ipconfig /flushdns')
      text = text.replace(/'((?:ipconfig|ping|nslookup|netsh|tracert)[^']*)'/gi, function () {
        if (!usedCmdNotice) {
          usedCmdNotice = true;
          return cmdReplacement;
        }
        return " ";
      });

      // 4. Strip markdown links [label](url) -> label, and bare URLs
      text = text.replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, "$1");
      text = text.replace(/https?:\/\/\S+/g, "");

      // 5. Strip emojis and pictographs
      text = text.replace(
        /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}•▪▸►]/gu,
        " "
      );

      // 6. Strip remaining markdown formatting tokens
      text = text
        .replace(/[*_#`~[\]<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return text;
    }

    /**
     * Split sanitized text into natural sentence chunks (<= 160 chars) to avoid Chrome's 15-second TTS cutoff.
     */
    function splitIntoSentenceChunks(cleanText) {
      if (!cleanText) return [];
      // Protect IPv4 dots (e.g. 1.1.1.1 or 8.8.8.8 or 192.168.1.1) from sentence splitting
      var protectedText = cleanText.replace(/(\d)\.(\d)/g, "$1__DOT__$2").replace(/(\d)\.(\d)/g, "$1__DOT__$2");

      var rawSentences = protectedText
        .split(/(?<=[.!?।])\s+/)
        .map(function (s) {
          return s.replace(/__DOT__/g, ".").trim();
        })
        .filter(Boolean);

      var chunks = [];
      rawSentences.forEach(function (sentence) {
        if (sentence.length <= 165) {
          chunks.push(sentence);
        } else {
          // Split long sentence on commas/semicolons/colons
          var subParts = sentence.split(/(?<=[,;:])\s+/);
          var acc = "";
          subParts.forEach(function (part) {
            if ((acc + " " + part).trim().length <= 165) {
              acc = (acc ? acc + " " : "") + part;
            } else {
              if (acc) chunks.push(acc);
              acc = part;
            }
          });
          if (acc) chunks.push(acc);
        }
      });

      return chunks.length > 0 ? chunks : [cleanText];
    }

    function processNextSpeechChunk() {
      if (!isSynthesisSupported()) {
        isQueueSpeaking = false;
        if (typeof currentUtteranceEndCallback === "function") {
          var cb = currentUtteranceEndCallback;
          currentUtteranceEndCallback = null;
          cb();
        }
        return;
      }

      if (speechQueue.length === 0) {
        isQueueSpeaking = false;
        if (typeof currentUtteranceEndCallback === "function") {
          var doneCb = currentUtteranceEndCallback;
          currentUtteranceEndCallback = null;
          doneCb();
        }
        return;
      }

      isQueueSpeaking = true;
      var chunkText = speechQueue.shift();

      try {
        var utterance = new SpeechSynthesisUtterance(chunkText);
        utterance.lang = appState.voiceLang || "en-IN";
        var voice = getVoiceForLang(utterance.lang);
        if (voice) utterance.voice = voice;
        utterance.rate = 1.05;
        utterance.pitch = 1.0;

        utterance.onend = function () {
          if (!isQueueSpeaking) return;
          if (speechQueue.length > 0) {
            chunkPauseTimer = setTimeout(function () {
              chunkPauseTimer = null;
              if (isQueueSpeaking) processNextSpeechChunk();
            }, 180);
          } else {
            processNextSpeechChunk();
          }
        };

        utterance.onerror = function (e) {
          if (e && e.error === "interrupted") return;
          if (!isQueueSpeaking) return;
          processNextSpeechChunk();
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("Speech synthesis error:", err);
        isQueueSpeaking = false;
        speechQueue = [];
        if (typeof currentUtteranceEndCallback === "function") {
          var errCb = currentUtteranceEndCallback;
          currentUtteranceEndCallback = null;
          errCb();
        }
      }
    }

    function speakText(textToSpeak, onEndCallback, forceSpeak) {
      if (!isSynthesisSupported()) {
        if (typeof onEndCallback === "function") onEndCallback();
        return;
      }
      if (!appState.voiceSpeakerEnabled && !forceSpeak) {
        if (typeof onEndCallback === "function") onEndCallback();
        return;
      }

      stopSpeaking();

      var clean = sanitizeTextForSpeech(textToSpeak);
      if (!clean) {
        if (typeof onEndCallback === "function") onEndCallback();
        return;
      }

      speechQueue = splitIntoSentenceChunks(clean);
      currentUtteranceEndCallback = typeof onEndCallback === "function" ? onEndCallback : null;
      processNextSpeechChunk();
    }

    function toggleRecording(textareaElement, onStateChange) {
      if (!isRecognitionSupported()) {
        appState.speechErrorMessage = "Speech recognition is not supported in this browser.";
        if (typeof onStateChange === "function") onStateChange();
        return;
      }

      if (appState.isRecording) {
        stopRecording();
        if (typeof onStateChange === "function") onStateChange();
        return;
      }

      startRecording(textareaElement, onStateChange);
    }

    function startRecording(textareaElement, onStateChange) {
      // Cancel any active text-to-speech audio immediately when user starts recording
      stopSpeaking();

      appState.speechErrorMessage = null;
      baseTextBeforeSpeech = (textareaElement ? textareaElement.value : "").trim();
      currentInterimText = "";

      try {
        recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.maxAlternatives = 1;
        recognitionInstance.lang = appState.voiceLang || "en-IN";

        recognitionInstance.onstart = function () {
          appState.isRecording = true;
          appState.speechErrorMessage = null;
          if (typeof onStateChange === "function") onStateChange();
        };

        recognitionInstance.onresult = function (event) {
          var finalTranscripts = "";
          var interimTranscripts = "";

          for (var i = event.resultIndex; i < event.results.length; i++) {
            var item = event.results[i];
            var transcript = item[0] ? item[0].transcript : "";
            if (item.isFinal) {
              finalTranscripts += transcript + " ";
            } else {
              interimTranscripts += transcript;
            }
          }

          if (finalTranscripts) {
            var normalizedFinal = normalizeTranscript(finalTranscripts);
            baseTextBeforeSpeech = (baseTextBeforeSpeech ? baseTextBeforeSpeech + " " : "") + normalizedFinal.trim();
          }

          currentInterimText = normalizeTranscript(interimTranscripts).trim();

          if (textareaElement) {
            var combined = baseTextBeforeSpeech;
            if (currentInterimText) {
              combined = (combined ? combined + " " : "") + currentInterimText;
            }
            textareaElement.value = combined;
            autoResizeChatTextarea(textareaElement);
            var composer = textareaElement.closest('[data-framer-name="Reply composer"]');
            var sendBtn = composer
              ? composer.querySelector('[data-framer-name="Send reply"], [data-framer-name="Send"]')
              : null;
            updateSendButtonVisual(textareaElement, sendBtn);
          }
        };

        recognitionInstance.onerror = function (event) {
          var err = event.error;
          if (err === "no-speech") {
            appState.speechErrorMessage = "No speech detected. Please try speaking again.";
          } else if (err === "not-allowed" || err === "service-not-allowed") {
            appState.speechErrorMessage = "Microphone permission denied. Allow mic access in browser.";
          } else if (err !== "aborted") {
            appState.speechErrorMessage = "Speech recognition error (" + err + ").";
          }
          appState.isRecording = false;
          if (typeof onStateChange === "function") onStateChange();
        };

        recognitionInstance.onend = function () {
          appState.isRecording = false;
          if (textareaElement) {
            textareaElement.value = baseTextBeforeSpeech;
            autoResizeChatTextarea(textareaElement);
            var composer = textareaElement.closest('[data-framer-name="Reply composer"]');
            var sendBtn = composer
              ? composer.querySelector('[data-framer-name="Send reply"], [data-framer-name="Send"]')
              : null;
            updateSendButtonVisual(textareaElement, sendBtn);
          }
          if (typeof onStateChange === "function") onStateChange();
        };

        recognitionInstance.start();
      } catch (err) {
        console.warn("Speech recognition start failed:", err);
        appState.speechErrorMessage = "Could not activate microphone. Check browser permissions.";
        appState.isRecording = false;
        if (typeof onStateChange === "function") onStateChange();
      }
    }

    function stopRecording() {
      if (recognitionInstance) {
        try {
          recognitionInstance.stop();
        } catch (_e) {}
        recognitionInstance = null;
      }
      appState.isRecording = false;
    }

    /**
     * Extract TurnPresentation from a message object (supports top-level `msg.presentation` or `msg.extra_data.presentation`),
     * or build a clean client-side fallback presentation for backward compatibility with older messages.
     */
    function getMessagePresentation(msg) {
      if (!msg) return null;
      var pres = msg.presentation || (msg.extra_data && msg.extra_data.presentation) || null;
      if (pres && typeof pres === "object" && pres.spoken && pres.summary && pres.question) {
        return pres;
      }
      return null;
    }

    /**
     * Build the exact spoken text for a message:
     * - Speaks ONLY `presentation.spoken` (never checks, commands, or user's transcript).
     * - If `checks` exist and `spoken` doesn't mention them, appends "I've put N checks on screen."
     * - Backward compatible: if an old message has no `presentation`, falls back to sanitized message content.
     */
    function buildSpokenTextForMessage(msg) {
      if (!msg) return "";
      var pres = getMessagePresentation(msg);
      if (pres && pres.spoken) {
        var baseSpoken = String(pres.spoken).trim();
        var checksList = Array.isArray(pres.checks) ? pres.checks : [];
        if (checksList.length > 0) {
          var mentionsChecks = /\b(check|checks|step|steps|on screen|स्क्रीन|जांच|चरण)\b/i.test(baseSpoken);
          if (!mentionsChecks) {
            var n = checksList.length;
            var suffix =
              appState.voiceLang === "hi-IN"
                ? " मैंने स्क्रीन पर " + n + " जांच चरण रखे हैं।"
                : " I've put " + n + (n === 1 ? " check" : " checks") + " on screen.";
            baseSpoken = baseSpoken.replace(/[.!?]*$/, ".") + suffix;
          }
        }
        return baseSpoken;
      }

      // Backward compatibility for old messages without presentation
      return sanitizeTextForSpeech(msg.content || "");
    }

    return {
      isRecognitionSupported: isRecognitionSupported,
      isSynthesisSupported: isSynthesisSupported,
      setLanguage: setLanguage,
      setSpeakerEnabled: setSpeakerEnabled,
      setPreferredVoiceURI: setPreferredVoiceURI,
      getAvailableVoicesForLang: getAvailableVoicesForLang,
      stopSpeaking: stopSpeaking,
      speakText: speakText,
      toggleRecording: toggleRecording,
      stopRecording: stopRecording,
      normalizeTranscript: normalizeTranscript,
      sanitizeTextForSpeech: sanitizeTextForSpeech,
      getMessagePresentation: getMessagePresentation,
      buildSpokenTextForMessage: buildSpokenTextForMessage,
    };
  })();

  // ============================================================================
  // HANDS-FREE VOICE MODE STATE MACHINE MODULE
  // States: "idle" -> "listening" -> "thinking" -> "speaking" -> "listening"
  // ============================================================================
  var CluezyVoiceMode = (function () {
    var SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    var state = "idle"; // "idle" | "listening" | "thinking" | "speaking"
    var isOpen = false;
    var vmRecognition = null;
    var accumulatedFinal = "";
    var liveInterim = "";
    var silenceTimer = null;
    var cancelWindowTimer = null;
    var restartTimer = null;
    var isCancelWindowActive = false;
    var retryCount = 0;
    var MAX_RETRIES = 4;
    var SILENCE_AUTO_SEND_MS = 1500;
    var CANCEL_WINDOW_MS = 1100;
    var vmErrorMessage = null;
    var inRunbookStepFlow = false;

    function isSupported() {
      return Boolean(SpeechRecognition) && CluezyVoice.isSynthesisSupported();
    }

    function getState() {
      return state;
    }

    function getIsOpen() {
      return isOpen;
    }

    function clearTimers() {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (cancelWindowTimer) {
        clearTimeout(cancelWindowTimer);
        cancelWindowTimer = null;
      }
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      isCancelWindowActive = false;
    }

    function stopRecognitionInstance() {
      if (vmRecognition) {
        try {
          vmRecognition.onend = null;
          vmRecognition.onerror = null;
          vmRecognition.onresult = null;
          vmRecognition.stop();
        } catch (_e) {}
        vmRecognition = null;
      }
    }

    function transitionTo(newState) {
      state = newState;
      updateOverlayDOM();
    }

    /**
     * Fuzzy-match spoken answer to available quick-reply option labels.
     * Supports case-insensitive substring matching and simple affirmative/negative/uncertain synonyms.
     */
    function matchQuickReplyOption(spokenText, options) {
      if (!spokenText || !Array.isArray(options) || options.length === 0) return null;
      var clean = spokenText.toLowerCase().replace(/[.,!?]/g, "").trim();
      if (!clean) return null;

      // 1. Exact or strong substring match against option labels
      for (var i = 0; i < options.length; i++) {
        var opt = String(options[i]);
        var optLow = opt.toLowerCase().replace(/[.,!?]/g, "").trim();
        if (clean === optLow || (clean.length >= 4 && optLow.indexOf(clean) >= 0) || (optLow.length >= 4 && clean.indexOf(optLow) >= 0)) {
          return opt;
        }
      }

      // 2. Affirmative synonyms (yes / yeah / yep / yup / working / opens / han / haan)
      var isAffirmative = /\b(yes|yeah|yep|yup|sure|working|works|opens|opened|reachable|replies|green|white|normal|resolved|fixed|हाँ|हां|जी)\b/i.test(clean) &&
        !/\b(not|no|doesn't|does not|can't|cannot|नहीं)\b/i.test(clean);
      if (isAffirmative) {
        var posMatch = options.find(function (o) {
          var l = o.toLowerCase();
          return (
            (/\b(yes|opens|working|work|replies|green|normal|resolved|valid)\b/.test(l)) &&
            !/\b(not|no|doesn't|unreachable|down|still)\b/.test(l)
          );
        });
        if (posMatch) return posMatch;
      }

      // 3. Negative synonyms (no / nope / nah / not working / doesn't open / nahi)
      var isNegative = /\b(no|nope|nah|not working|doesn't|does not|timed out|unreachable|down|red|orange|blinking|still not|नहीं|ना)\b/i.test(clean);
      if (isNegative) {
        var negMatch = options.find(function (o) {
          var l = o.toLowerCase();
          return /\b(no|not|doesn't|unreachable|down|red|orange|error|still|failed|apipa)\b/.test(l);
        });
        if (negMatch) return negMatch;
      }

      // 4. Uncertain / help synonyms (not sure / don't know / help)
      var isUncertain = /\b(not sure|don't know|do not know|unsure|skip|cannot access|पता नहीं)\b/i.test(clean);
      if (isUncertain) {
        var uncMatch = options.find(function (o) {
          var l = o.toLowerCase();
          return /\b(not sure|unsure|unknown|cannot|skip)\b/.test(l);
        });
        if (uncMatch) return uncMatch;
      }

      var isHelp = /\b(help|need help|explain|how to|मदद)\b/i.test(clean);
      if (isHelp) {
        var helpMatch = options.find(function (o) {
          return o.toLowerCase().indexOf("help") >= 0;
        });
        if (helpMatch) return helpMatch;
      }

      return null;
    }

    function getActiveRunbookAction() {
      var inv = appState.currentInvestigation;
      if (!inv || !Array.isArray(inv.recommended_actions) || inv.recommended_actions.length === 0) return null;
      var pending = inv.recommended_actions.filter(function (a) {
        return a.status === "pending";
      });
      return pending.length > 0 ? pending[pending.length - 1] : null;
    }

    function getLatestQuickReplies() {
      var inv = appState.currentInvestigation;
      if (!inv || !Array.isArray(inv.messages)) return { options: [], questionId: null, message: null, presentation: null };
      for (var i = inv.messages.length - 1; i >= 0; i--) {
        if (inv.messages[i].sender === "assistant") {
          var m = inv.messages[i];
          var pres = CluezyVoice.getMessagePresentation(m);
          var opts =
            pres && pres.question && Array.isArray(pres.question.options) && pres.question.options.length > 0
              ? pres.question.options
              : Array.isArray(m.suggested_responses) && m.suggested_responses.length > 0
              ? m.suggested_responses
              : m.extra_data && Array.isArray(m.extra_data.quick_replies)
              ? m.extra_data.quick_replies
              : [];
          var qId = m.extra_data ? m.extra_data.question_id : null;
          return { options: opts, questionId: qId, message: m, presentation: pres };
        }
      }
      return { options: [], questionId: null, message: null, presentation: null };
    }

    function getCurrentTurnChecksList() {
      var latest = getLatestQuickReplies();
      if (latest.presentation && Array.isArray(latest.presentation.checks) && latest.presentation.checks.length > 0) {
        return latest.presentation.checks.map(function (c) {
          return c.title + ". " + c.detail;
        });
      }
      var activeAct = getActiveRunbookAction();
      if (activeAct && Array.isArray(activeAct.steps) && activeAct.steps.length > 0) {
        return activeAct.steps;
      }
      return [];
    }

    /**
     * Handle special voice commands during Voice Mode:
     * - "read the steps": reads checks one at a time, then waits for "done", "next", or "didn't work".
     * - "repeat": repeats `presentation.spoken`.
     * - "stop", "exit voice mode"
     * Returns true if handled as a command.
     */
    function handleVoiceCommandIfMatched(spoken) {
      var low = spoken.toLowerCase().replace(/[.,!?]/g, "").trim();

      // Exit commands
      if (/\b(exit voice mode|close voice mode|stop voice mode|quit voice mode|बंद करो)\b/i.test(low) || low === "exit" || low === "close") {
        closeOverlay();
        return true;
      }

      if (low === "stop" || low === "quiet" || low === "रुको") {
        CluezyVoice.stopSpeaking();
        startListeningState();
        return true;
      }

      var steps = getCurrentTurnChecksList();

      // "read the steps" command: read check 1 of N, then wait for "done", "next", or "didn't work"
      if (/\b(read the steps|read steps|read the checks|read checks|चरण पढ़ें)\b/i.test(low)) {
        if (steps.length > 0) {
          inRunbookStepFlow = true;
          appState.solutionActiveStepIndex = 0;
          speakRunbookStepInVoiceMode(0, steps);
        } else {
          speakInVoiceMode(
            appState.voiceLang === "hi-IN"
              ? "इस चरण के लिए कोई अतिरिक्त सूची नहीं है।"
              : "There are no extra checklist steps on screen for this question."
          );
        }
        return true;
      }

      if (steps.length > 0 && inRunbookStepFlow) {
        if (/\b(next|next step|done|completed|अगला|आगे|हो गया)\b/i.test(low) && low.split(/\s+/).length <= 4) {
          var nextIdx = (appState.solutionActiveStepIndex || 0) + 1;
          if (nextIdx >= steps.length) {
            inRunbookStepFlow = false;
            speakInVoiceMode(
              appState.voiceLang === "hi-IN"
                ? "सभी चरण पूरे हो गए हैं। क्या अब यह काम कर रहा है, या अभी भी समस्या है?"
                : "That was the final check. Let me know: did it work, or didn't work?"
            );
          } else {
            appState.solutionActiveStepIndex = nextIdx;
            speakRunbookStepInVoiceMode(nextIdx, steps);
          }
          return true;
        }

        if (/\b(didn't work|did not work|still not working|not working|failed|काम नहीं किया)\b/i.test(low)) {
          inRunbookStepFlow = false;
          // Let normal turn submission handle "Still not working"
          return false;
        }
      }

      // "repeat" repeats presentation.spoken
      if (/\b(repeat|say that again|repeat question|फिर से बोलो|दोहराएं)\b/i.test(low) && low.split(/\s+/).length <= 4) {
        inRunbookStepFlow = false;
        speakCurrentContextPrompt();
        return true;
      }

      return false;
    }

    function speakRunbookStepInVoiceMode(stepIdx, stepsList) {
      var stepText = stepsList[stepIdx] || "";
      var promptSuffix =
        appState.voiceLang === "hi-IN"
          ? " अगला, हो गया, या काम नहीं किया बोलें।"
          : " Say done, next, or didn't work.";
      var prefix =
        appState.voiceLang === "hi-IN"
          ? "जांच " + (stepIdx + 1) + " कुल " + stepsList.length + " में से: "
          : "Check " + (stepIdx + 1) + " of " + stepsList.length + ": ";
      speakInVoiceMode(prefix + stepText + "." + promptSuffix);
    }

    function speakInVoiceMode(textToRead) {
      if (!isOpen) return;
      // CRITICAL: Stop recognition BEFORE speaking to prevent echo feedback loop
      clearTimers();
      stopRecognitionInstance();
      transitionTo("speaking");

      CluezyVoice.speakText(
        textToRead,
        function () {
          if (!isOpen) return;
          if (state === "speaking") {
            startListeningState();
          }
        },
        true // forceSpeak = true inside Voice Mode regardless of header read-aloud toggle
      );
    }

    function speakCurrentContextPrompt() {
      var inv = appState.currentInvestigation;
      if (!inv || !Array.isArray(inv.messages) || inv.messages.length === 0) {
        var welcome =
          appState.voiceLang === "hi-IN"
            ? "नमस्ते! अपनी तकनीकी समस्या बताएं, मैं आपकी मदद करूंगा।"
            : "Voice mode ready. Describe your technical problem whenever you're ready.";
        speakInVoiceMode(welcome);
        return;
      }

      var latest = getLatestQuickReplies();
      if (latest.message) {
        var msgId = latest.message.id || latest.message.content;
        appState.lastSpokenMessageId = msgId;
        // Speak ONLY presentation.spoken (plus "I've put N checks on screen." if checks exist and aren't mentioned)
        var spokenOnly = CluezyVoice.buildSpokenTextForMessage(latest.message);
        speakInVoiceMode(spokenOnly);
      } else {
        startListeningState();
      }
    }

    function startListeningState() {
      if (!isOpen) return;
      clearTimers();
      CluezyVoice.stopSpeaking();
      stopRecognitionInstance();

      accumulatedFinal = "";
      liveInterim = "";
      isCancelWindowActive = false;
      vmErrorMessage = null;
      transitionTo("listening");

      try {
        vmRecognition = new SpeechRecognition();
        vmRecognition.continuous = true;
        vmRecognition.interimResults = true;
        vmRecognition.maxAlternatives = 1;
        vmRecognition.lang = appState.voiceLang || "en-IN";

        vmRecognition.onstart = function () {
          retryCount = 0;
          vmErrorMessage = null;
          updateOverlayDOM();
        };

        vmRecognition.onresult = function (event) {
          if (!isOpen || state !== "listening") return;
          var finalChunk = "";
          var interimChunk = "";

          for (var i = event.resultIndex; i < event.results.length; i++) {
            var res = event.results[i];
            var tr = res[0] ? res[0].transcript : "";
            if (res.isFinal) {
              finalChunk += tr + " ";
            } else {
              interimChunk += tr;
            }
          }

          if (finalChunk) {
            var normF = CluezyVoice.normalizeTranscript(finalChunk).trim();
            if (normF) {
              accumulatedFinal = (accumulatedFinal ? accumulatedFinal + " " : "") + normF;
            }
          }
          liveInterim = CluezyVoice.normalizeTranscript(interimChunk).trim();

          // Reset silence timer on every speech activity
          if (silenceTimer) clearTimeout(silenceTimer);
          if (cancelWindowTimer) clearTimeout(cancelWindowTimer);
          isCancelWindowActive = false;

          var combined = (accumulatedFinal + (liveInterim ? " " + liveInterim : "")).trim();
          updateOverlayDOM();

          // Schedule auto-send after ~1.5s of silence if meaningful speech (>= 2 chars) exists
          if (combined.length >= 2) {
            silenceTimer = setTimeout(function () {
              triggerAutoSendWithCancelWindow();
            }, SILENCE_AUTO_SEND_MS);
          }
        };

        vmRecognition.onerror = function (event) {
          if (!isOpen) return;
          var err = event.error;
          if (err === "not-allowed" || err === "service-not-allowed") {
            vmErrorMessage = "Microphone permission denied. Exiting Voice Mode…";
            updateOverlayDOM();
            setTimeout(function () {
              appState.speechErrorMessage = "Microphone permission denied. Please allow microphone access.";
              closeOverlay();
              renderInvestigationView();
            }, 1600);
            return;
          }
          if (err === "no-speech" || err === "aborted") {
            // Normal silence timeout in Chrome; onend will handle auto-restart
            return;
          }
          retryCount++;
          if (retryCount > MAX_RETRIES) {
            vmErrorMessage = "Voice recognition unavailable after multiple retries. Exiting…";
            updateOverlayDOM();
            setTimeout(function () {
              closeOverlay();
            }, 1800);
          }
        };

        vmRecognition.onend = function () {
          if (!isOpen || state !== "listening" || isCancelWindowActive) return;
          // Auto-restart recognition on Chrome's silent end/timeout with exponential backoff
          if (retryCount <= MAX_RETRIES) {
            var delay = Math.min(2000, 250 * Math.pow(1.6, retryCount));
            retryCount++;
            restartTimer = setTimeout(function () {
              if (isOpen && state === "listening" && !isCancelWindowActive) {
                startListeningState();
              }
            }, delay);
          } else {
            vmErrorMessage = "Voice session timed out due to inactivity.";
            updateOverlayDOM();
            setTimeout(function () {
              closeOverlay();
            }, 1600);
          }
        };

        vmRecognition.start();
      } catch (e) {
        retryCount++;
        if (retryCount > MAX_RETRIES) {
          vmErrorMessage = "Could not start microphone recognition.";
          updateOverlayDOM();
          setTimeout(closeOverlay, 1600);
        }
      }
    }

    function triggerAutoSendWithCancelWindow() {
      if (!isOpen || state !== "listening") return;
      var fullText = (accumulatedFinal + (liveInterim ? " " + liveInterim : "")).trim();
      // Ignore empty or very short noise (< 2 chars)
      if (!fullText || fullText.length < 2) {
        return;
      }

      stopRecognitionInstance();
      isCancelWindowActive = true;
      updateOverlayDOM();

      cancelWindowTimer = setTimeout(function () {
        isCancelWindowActive = false;
        submitVoiceTurn(fullText);
      }, CANCEL_WINDOW_MS);
    }

    function cancelPendingAutoSendToEdit() {
      clearTimers();
      var fullText = (accumulatedFinal + (liveInterim ? " " + liveInterim : "")).trim();
      var ta = document.querySelector("textarea.cluezy-chat-textarea");
      if (ta && fullText) {
        ta.value = fullText;
        autoResizeChatTextarea(ta);
      }
      closeOverlay();
      if (ta) ta.focus();
    }

    async function submitVoiceTurn(spokenText) {
      if (!isOpen) return;
      clearTimers();
      stopRecognitionInstance();

      // 1. Check voice navigation/runbook commands first
      if (handleVoiceCommandIfMatched(spokenText)) {
        return;
      }

      transitionTo("thinking");

      var inv = appState.currentInvestigation;
      var isNew =
        !inv ||
        !Array.isArray(inv.messages) ||
        inv.messages.length === 0 ||
        inv.status === "resolved";

      try {
        if (isNew) {
          if (spokenText.length < 5) {
            speakInVoiceMode(
              appState.voiceLang === "hi-IN"
                ? "कृपया अपनी समस्या का थोड़ा और विवरण दें।"
                : "Could you describe the technical problem with a few more words?"
            );
            return;
          }
          await startNewInvestigation(spokenText, null);
        } else {
          // Fuzzy-match against current quick-reply options
          var latest = getLatestQuickReplies();
          var matchedOpt = matchQuickReplyOption(spokenText, latest.options);
          if (matchedOpt) {
            await handleQuickReplyClick(inv, matchedOpt, latest.questionId);
          } else {
            appState.isSubmitting = true;
            renderInvestigationView();
            var updated = await API.submitMessage(inv.reference_id, spokenText, latest.questionId);
            appState.currentInvestigation = updated;
            appState.isSubmitting = false;
            renderInvestigationView();
          }
        }

        if (!isOpen) return;
        speakCurrentContextPrompt();
      } catch (err) {
        appState.isSubmitting = false;
        if (!isOpen) return;
        speakInVoiceMode("Sorry, there was a connection issue. Please try saying that again.");
      }
    }

    function openOverlay() {
      if (!isSupported()) return;
      // Stop any chat-level recording or speech first
      CluezyVoice.stopRecording();
      CluezyVoice.stopSpeaking();

      isOpen = true;
      retryCount = 0;
      vmErrorMessage = null;
      accumulatedFinal = "";
      liveInterim = "";
      ensureOverlayMounted();
      speakCurrentContextPrompt();
    }

    function closeOverlay() {
      isOpen = false;
      clearTimers();
      stopRecognitionInstance();
      CluezyVoice.stopSpeaking();
      state = "idle";
      var overlay = document.getElementById("cluezy-voice-mode-overlay");
      if (overlay) {
        overlay.classList.remove("open");
      }
    }

    function handleOverlayOrbOrTap() {
      if (!isOpen) return;
      if (state === "speaking") {
        // Interrupt speech immediately and return to listening
        CluezyVoice.stopSpeaking();
        startListeningState();
      } else if (state === "listening" && isCancelWindowActive) {
        // Cancel auto-send and restart listening
        clearTimers();
        startListeningState();
      } else if (state === "listening") {
        var fullText = (accumulatedFinal + (liveInterim ? " " + liveInterim : "")).trim();
        if (fullText.length >= 2) {
          clearTimers();
          submitVoiceTurn(fullText);
        }
      }
    }

    function ensureOverlayMounted() {
      var overlay = document.getElementById("cluezy-voice-mode-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "cluezy-voice-mode-overlay";
        overlay.className = "cluezy-vm-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Cluezy Hands-Free Voice Mode");

        overlay.innerHTML =
          '<div class="cluezy-vm-topbar">' +
            '<div class="cluezy-vm-brand">' +
              '<span class="cluezy-vm-dot"></span>' +
              '<span>CLUEZY Voice Mode</span>' +
            '</div>' +
            '<div class="cluezy-vm-top-actions">' +
              '<select class="cluezy-vm-lang-select" aria-label="Voice language">' +
                '<option value="en-IN">English (IN)</option>' +
                '<option value="hi-IN">हिंदी (HI)</option>' +
              '</select>' +
              '<select class="cluezy-vm-voice-select" aria-label="Preferred speech voice" title="Select TTS Voice"></select>' +
              '<button type="button" class="cluezy-vm-close-btn" aria-label="Exit Voice Mode">Exit ✕</button>' +
            '</div>' +
          '</div>' +
          '<div class="cluezy-vm-center" id="cluezy-vm-tap-zone">' +
            '<div class="cluezy-vm-state-badge" id="cluezy-vm-state-badge">IDLE</div>' +
            '<div class="cluezy-vm-orb-wrap" id="cluezy-vm-orb-wrap">' +
              '<div class="cluezy-vm-orb-ring cluezy-vm-orb-ring-1"></div>' +
              '<div class="cluezy-vm-orb-ring cluezy-vm-orb-ring-2"></div>' +
              '<div class="cluezy-vm-orb">' +
                '<div class="cluezy-vm-waveform">' +
                  '<span></span><span></span><span></span><span></span><span></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="cluezy-vm-turn-card" id="cluezy-vm-turn-card">' +
              '<div class="cluezy-vm-turn-summary" id="cluezy-vm-turn-summary"></div>' +
              '<div class="cluezy-vm-turn-checklist" id="cluezy-vm-turn-checklist"></div>' +
              '<div class="cluezy-vm-turn-question" id="cluezy-vm-turn-question"></div>' +
              '<div class="cluezy-vm-options-pills" id="cluezy-vm-options-pills"></div>' +
            '</div>' +
            '<div class="cluezy-vm-yousaid-row" id="cluezy-vm-yousaid-row">' +
              '<span class="cluezy-vm-yousaid-text" id="cluezy-vm-transcript-box"></span>' +
              '<button type="button" class="cluezy-vm-yousaid-edit" id="cluezy-vm-inline-edit-btn" title="Edit in chat input" aria-label="Edit transcript in chat">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="cluezy-vm-footer">' +
            '<button type="button" class="cluezy-vm-action-btn" id="cluezy-vm-edit-btn">Cancel / Edit in Chat</button>' +
            '<span class="cluezy-vm-hint" id="cluezy-vm-hint">Say "read the steps", "repeat", or tap orb to interrupt</span>' +
          '</div>';

        document.body.appendChild(overlay);

        var closeBtn = overlay.querySelector(".cluezy-vm-close-btn");
        closeBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          closeOverlay();
        });

        var langSel = overlay.querySelector(".cluezy-vm-lang-select");
        langSel.value = appState.voiceLang || "en-IN";
        langSel.addEventListener("change", function (e) {
          e.stopPropagation();
          CluezyVoice.setLanguage(langSel.value);
          document.querySelectorAll(".cluezy-voice-lang-select").forEach(function (s) {
            s.value = langSel.value;
          });
          populateVoiceSelectDropdowns();
          if (state === "listening") {
            startListeningState();
          }
        });

        var voiceSel = overlay.querySelector(".cluezy-vm-voice-select");
        if (voiceSel) {
          voiceSel.addEventListener("change", function (e) {
            e.stopPropagation();
            CluezyVoice.setPreferredVoiceURI(voiceSel.value);
            document.querySelectorAll(".cluezy-voice-uri-select, .cluezy-vm-voice-select").forEach(function (s) {
              s.value = voiceSel.value;
            });
          });
        }

        var orbWrap = overlay.querySelector("#cluezy-vm-orb-wrap");
        if (orbWrap) {
          orbWrap.addEventListener("click", function (e) {
            e.stopPropagation();
            handleOverlayOrbOrTap();
          });
        }

        var editBtn = overlay.querySelector("#cluezy-vm-edit-btn");
        editBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          cancelPendingAutoSendToEdit();
        });

        var inlineEditBtn = overlay.querySelector("#cluezy-vm-inline-edit-btn");
        if (inlineEditBtn) {
          inlineEditBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            cancelPendingAutoSendToEdit();
          });
        }
      }

      var langSelectEl = overlay.querySelector(".cluezy-vm-lang-select");
      if (langSelectEl) langSelectEl.value = appState.voiceLang || "en-IN";
      populateVoiceSelectDropdowns();

      overlay.classList.add("open");
      updateOverlayDOM();
    }

    function updateOverlayDOM() {
      var overlay = document.getElementById("cluezy-voice-mode-overlay");
      if (!overlay || !isOpen) return;

      overlay.setAttribute("data-vm-state", state);

      var badge = document.getElementById("cluezy-vm-state-badge");
      var summaryEl = document.getElementById("cluezy-vm-turn-summary");
      var checklistEl = document.getElementById("cluezy-vm-turn-checklist");
      var questionEl = document.getElementById("cluezy-vm-turn-question");
      var transcriptBox = document.getElementById("cluezy-vm-transcript-box");
      var inlineEditBtn = document.getElementById("cluezy-vm-inline-edit-btn");
      var optionsBox = document.getElementById("cluezy-vm-options-pills");
      var hintEl = document.getElementById("cluezy-vm-hint");
      var editBtn = document.getElementById("cluezy-vm-edit-btn");

      var stateLabels = {
        idle: "Ready",
        listening: isCancelWindowActive ? "Sending in 1s… (Tap Orb to Cancel)" : "Listening…",
        thinking: "Thinking…",
        speaking: "Speaking… (Tap Orb to Interrupt)",
      };
      if (badge) {
        badge.textContent = vmErrorMessage ? "Alert" : (stateLabels[state] || state.toUpperCase());
      }

      // Render Turn Card: summary line, numbered tickable checklist (with command copy button), large question text, option chips
      var latest = getLatestQuickReplies();
      var pres = latest.presentation;

      if (summaryEl) {
        if (pres && pres.summary) {
          summaryEl.textContent = pres.summary;
          summaryEl.style.display = "block";
        } else if (latest.message && latest.message.content) {
          // Backward compatibility for messages without presentation: no truncation!
          var firstPara = String(latest.message.content).split("\n\n")[0] || "";
          summaryEl.textContent = firstPara;
          summaryEl.style.display = "block";
        } else {
          summaryEl.textContent = "Hands-free voice diagnostic session ready.";
          summaryEl.style.display = "block";
        }
      }

      if (checklistEl) {
        checklistEl.innerHTML = "";
        var checksList = pres && Array.isArray(pres.checks) ? pres.checks : [];
        if (checksList.length > 0) {
          checklistEl.style.display = "flex";
          checksList.forEach(function (chk, idx) {
            var chkKey = "vm_chk_" + idx + "_" + (chk.title || "");
            var isChecked = Boolean(appState.checkedChecklistKeys[chkKey]);

            var row = document.createElement("div");
            row.className = "cluezy-turn-check-item" + (isChecked ? " checked" : "");

            var labelWrap = document.createElement("label");
            labelWrap.className = "cluezy-turn-check-label";

            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "cluezy-turn-check-cb";
            cb.checked = isChecked;
            cb.addEventListener("change", function (e) {
              e.stopPropagation();
              appState.checkedChecklistKeys[chkKey] = cb.checked;
              if (cb.checked) row.classList.add("checked");
              else row.classList.remove("checked");
            });

            var textCol = document.createElement("div");
            textCol.className = "cluezy-turn-check-text";
            var titleStrong = document.createElement("div");
            titleStrong.className = "cluezy-turn-check-title";
            titleStrong.textContent = (idx + 1) + ". " + (chk.title || "Check");
            var detailSpan = document.createElement("div");
            detailSpan.className = "cluezy-turn-check-detail";
            detailSpan.textContent = chk.detail || "";
            textCol.appendChild(titleStrong);
            textCol.appendChild(detailSpan);

            labelWrap.appendChild(cb);
            labelWrap.appendChild(textCol);
            row.appendChild(labelWrap);

            if (chk.command) {
              var cmdBar = document.createElement("div");
              cmdBar.className = "cluezy-turn-cmd-bar";
              var codeEl = document.createElement("code");
              codeEl.className = "cluezy-turn-cmd-code";
              codeEl.textContent = chk.command;

              var copyBtn = document.createElement("button");
              copyBtn.type = "button";
              copyBtn.className = "cluezy-turn-cmd-copy";
              copyBtn.textContent = "Copy";
              copyBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(chk.command).then(function () {
                    copyBtn.textContent = "Copied ✓";
                    setTimeout(function () {
                      copyBtn.textContent = "Copy";
                    }, 1500);
                  });
                }
              });

              cmdBar.appendChild(codeEl);
              cmdBar.appendChild(copyBtn);
              row.appendChild(cmdBar);
            }

            checklistEl.appendChild(row);
          });
        } else {
          checklistEl.style.display = "none";
        }
      }

      if (questionEl) {
        if (pres && pres.question && pres.question.text) {
          questionEl.textContent = pres.question.text;
        } else if (latest.message && latest.message.content) {
          var paras = String(latest.message.content).split("\n\n");
          questionEl.textContent = paras[paras.length - 1] || latest.message.content;
        } else {
          questionEl.textContent = "Describe your technical issue to begin troubleshooting.";
        }
      }

      // Small "You said" line with edit icon
      var combined = (accumulatedFinal + (liveInterim ? " " + liveInterim : "")).trim();
      if (transcriptBox) {
        if (vmErrorMessage) {
          transcriptBox.textContent = vmErrorMessage;
          transcriptBox.classList.add("error");
          if (inlineEditBtn) inlineEditBtn.style.display = "none";
        } else {
          transcriptBox.classList.remove("error");
          if (combined) {
            transcriptBox.textContent = "You said: “" + combined + "”";
            if (inlineEditBtn) inlineEditBtn.style.display = "inline-flex";
          } else if (state === "listening") {
            transcriptBox.textContent =
              appState.voiceLang === "hi-IN" ? "बोलिए, मैं सुन रहा हूँ…" : "Listening for your answer…";
            if (inlineEditBtn) inlineEditBtn.style.display = "none";
          } else if (state === "thinking") {
            transcriptBox.textContent = "Analyzing evidence & diagnostic rules…";
            if (inlineEditBtn) inlineEditBtn.style.display = "none";
          } else {
            transcriptBox.textContent = "";
            if (inlineEditBtn) inlineEditBtn.style.display = "none";
          }
        }
      }

      // Show quick reply option chips
      if (optionsBox) {
        optionsBox.innerHTML = "";
        if (latest.options && latest.options.length > 0) {
          latest.options.forEach(function (opt) {
            var pill = document.createElement("button");
            pill.type = "button";
            pill.className = "cluezy-vm-opt-pill";
            pill.textContent = opt;
            pill.addEventListener("click", function (e) {
              e.stopPropagation();
              submitVoiceTurn(opt);
            });
            optionsBox.appendChild(pill);
          });
        }
      }

      if (editBtn) {
        editBtn.style.display = combined || isCancelWindowActive ? "inline-flex" : "none";
      }

      if (hintEl) {
        if (state === "speaking") {
          hintEl.textContent = "Tap orb to interrupt speech • Say 'read the steps' or 'repeat'";
        } else if (isCancelWindowActive) {
          hintEl.textContent = "Auto-sending… Tap orb to cancel or click edit icon";
        } else {
          hintEl.textContent = "Say 'read the steps', 'repeat', or answer the question above";
        }
      }
    }

    return {
      isSupported: isSupported,
      getState: getState,
      getIsOpen: getIsOpen,
      openOverlay: openOverlay,
      closeOverlay: closeOverlay,
      updateOverlayDOM: updateOverlayDOM,
    };
  })();

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
      "/* Cluezy Voice UI Controls */",
      ".cluezy-voice-controls-bar {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  width: 100% !important;",
      "  max-width: 680px !important;",
      "  margin: 6px auto 10px !important;",
      "  padding: 6px 12px !important;",
      "  border-radius: 12px !important;",
      "  background: #f7faf6 !important;",
      "  border: 1px solid #dfe5de !important;",
      "  box-sizing: border-box !important;",
      "  gap: 8px !important;",
      "  flex-wrap: wrap !important;",
      "}",
      ".cluezy-voice-actions-group {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 8px !important;",
      "}",
      ".cluezy-voice-btn {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  gap: 6px !important;",
      "  min-width: 44px !important;",
      "  min-height: 44px !important;",
      "  padding: 6px 12px !important;",
      "  border-radius: 10px !important;",
      "  border: 1.5px solid #dfe5de !important;",
      "  background: #ffffff !important;",
      "  color: #17251f !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 13px !important;",
      "  font-weight: 500 !important;",
      "  cursor: pointer !important;",
      "  transition: all 0.15s ease !important;",
      "  user-select: none !important;",
      "  -webkit-tap-highlight-color: transparent !important;",
      "}",
      ".cluezy-voice-btn:hover {",
      "  border-color: #145c38 !important;",
      "  background: #ecf6e8 !important;",
      "  color: #145c38 !important;",
      "}",
      ".cluezy-voice-btn.active {",
      "  background: #145c38 !important;",
      "  border-color: #145c38 !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-mic-btn {",
      "  border-radius: 50% !important;",
      "  width: 44px !important;",
      "  height: 44px !important;",
      "  padding: 0 !important;",
      "  flex-shrink: 0 !important;",
      "  margin-bottom: 2px !important;",
      "}",
      ".cluezy-mic-btn.recording {",
      "  background: var(--clz-danger, #b91c1c) !important;",
      "  border-color: var(--clz-danger, #b91c1c) !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-voice-lang-select {",
      "  min-height: 44px !important;",
      "  padding: 6px 10px !important;",
      "  border-radius: 8px !important;",
      "  border: 1px solid #dfe5de !important;",
      "  background: #ffffff !important;",
      "  color: #17251f !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 13px !important;",
      "  cursor: pointer !important;",
      "  outline: none !important;",
      "}",
      ".cluezy-voice-lang-select:focus {",
      "  border-color: #145c38 !important;",
      "}",
      ".cluezy-voice-status-msg {",
      "  font-size: 12px !important;",
      "  color: #991b1b !important;",
      "  background: #fef2f2 !important;",
      "  border: 1px solid #fecaca !important;",
      "  border-radius: 6px !important;",
      "  padding: 4px 10px !important;",
      "  margin: 4px 0 !important;",
      "  display: inline-block !important;",
      "  width: 100% !important;",
      "  box-sizing: border-box !important;",
      "}",
      "/* Runbook Step-by-Step Voice Guidance Box */",
      ".cluezy-solution-voice-box {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 10px !important;",
      "  padding: 14px 16px !important;",
      "  border-radius: 14px !important;",
      "  background: #ecf6e8 !important;",
      "  border: 1.5px solid #145c38 !important;",
      "  margin: 14px 0 16px !important;",
      "}",
      ".cluezy-solution-voice-header {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  font-weight: 600 !important;",
      "  color: #145c38 !important;",
      "  font-size: 13.5px !important;",
      "}",
      ".cluezy-solution-voice-actions {",
      "  display: flex !important;",
      "  gap: 10px !important;",
      "  align-items: center !important;",
      "  flex-wrap: wrap !important;",
      "}",
      ".cluezy-step-voice-btn {",
      "  min-height: 44px !important;",
      "  padding: 8px 16px !important;",
      "  border-radius: 8px !important;",
      "  border: 1px solid #145c38 !important;",
      "  background: #ffffff !important;",
      "  color: #145c38 !important;",
      "  font-weight: 600 !important;",
      "  font-size: 13px !important;",
      "  cursor: pointer !important;",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 6px !important;",
      "  user-select: none !important;",
      "  transition: all 0.15s ease !important;",
      "}",
      ".cluezy-step-voice-btn:hover {",
      "  background: #145c38 !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-step-active-highlight {",
      "  border-left: 4px solid #145c38 !important;",
      "  background: #f7faf6 !important;",
      "  padding-left: 10px !important;",
      "  border-radius: 4px !important;",
      "  transition: background 0.2s ease !important;",
      "}",
      "/* Chat Header Voice Controls */",
      ".cluezy-header-voice-slot {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 8px !important;",
      "  flex-wrap: wrap !important;",
      "}",
      ".cluezy-header-voice-btn {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  gap: 6px !important;",
      "  min-height: 44px !important;",
      "  min-width: 44px !important;",
      "  padding: 6px 12px !important;",
      "  border-radius: 10px !important;",
      "  border: 1.5px solid #dfe5de !important;",
      "  background: #ffffff !important;",
      "  color: #17251f !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 12.5px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  transition: all 0.15s ease !important;",
      "  user-select: none !important;",
      "}",
      ".cluezy-header-voice-btn:hover {",
      "  border-color: #145c38 !important;",
      "  background: #ecf6e8 !important;",
      "  color: #145c38 !important;",
      "}",
      ".cluezy-header-voice-btn.active {",
      "  background: #145c38 !important;",
      "  border-color: #145c38 !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-header-voicemode-btn {",
      "  background: #ecf6e8 !important;",
      "  border-color: #145c38 !important;",
      "  color: #145c38 !important;",
      "}",
      ".cluezy-header-voicemode-btn:hover {",
      "  background: #145c38 !important;",
      "  color: #ffffff !important;",
      "}",
      "/* Hands-Free Voice Mode Fullscreen Overlay */",
      ".cluezy-vm-overlay {",
      "  position: fixed !important;",
      "  inset: 0 !important;",
      "  width: 100vw !important;",
      "  height: 100vh !important;",
      "  height: 100dvh !important;",
      "  z-index: 99999 !important;",
      "  background: var(--clz-bg, #F9FAFB) !important;",
      "  color: var(--clz-text-primary, #111827) !important;",
      "  display: none !important;",
      "  flex-direction: column !important;",
      "  justify-content: space-between !important;",
      "  padding: calc(16px + env(safe-area-inset-top, 0px)) calc(20px + env(safe-area-inset-right, 0px)) calc(20px + env(safe-area-inset-bottom, 0px)) calc(20px + env(safe-area-inset-left, 0px)) !important;",
      "  box-sizing: border-box !important;",
      "  font-family: var(--clz-font-sans, 'Inter', sans-serif) !important;",
      "  overflow: hidden !important;",
      "}",
      ".cluezy-vm-overlay.open {",
      "  display: flex !important;",
      "}",
      ".cluezy-vm-topbar {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  width: 100% !important;",
      "  max-width: 760px !important;",
      "  margin: 0 auto !important;",
      "  gap: 12px !important;",
      "}",
      ".cluezy-vm-brand {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 8px !important;",
      "  font-weight: 700 !important;",
      "  font-size: 16px !important;",
      "  color: var(--clz-text-primary, #111827) !important;",
      "}",
      ".cluezy-vm-dot {",
      "  width: 8px !important;",
      "  height: 8px !important;",
      "  border-radius: 50% !important;",
      "  background: var(--clz-brand, #145C38) !important;",
      "}",
      ".cluezy-vm-top-actions {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  gap: 10px !important;",
      "}",
      ".cluezy-vm-lang-select,",
      ".cluezy-vm-voice-select {",
      "  min-height: 44px !important;",
      "  padding: 6px 10px !important;",
      "  border-radius: 10px !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.3) !important;",
      "  background: rgba(255, 255, 255, 0.08) !important;",
      "  color: #ffffff !important;",
      "  font-size: 12.5px !important;",
      "  font-weight: 500 !important;",
      "  cursor: pointer !important;",
      "  max-width: 170px !important;",
      "}",
      ".cluezy-vm-lang-select option,",
      ".cluezy-vm-voice-select option {",
      "  background: #13251e !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-voice-uri-select {",
      "  min-height: 44px !important;",
      "  padding: 6px 10px !important;",
      "  border-radius: 8px !important;",
      "  border: 1px solid #dfe5de !important;",
      "  background: #ffffff !important;",
      "  color: #17251f !important;",
      "  font-family: 'Inter', sans-serif !important;",
      "  font-size: 12.5px !important;",
      "  cursor: pointer !important;",
      "  max-width: 185px !important;",
      "}",
      ".cluezy-vm-close-btn {",
      "  min-height: 44px !important;",
      "  min-width: 44px !important;",
      "  padding: 8px 16px !important;",
      "  border-radius: 10px !important;",
      "  border: 1px solid rgba(255, 255, 255, 0.25) !important;",
      "  background: rgba(255, 255, 255, 0.1) !important;",
      "  color: #ffffff !important;",
      "  font-weight: 600 !important;",
      "  font-size: 13.5px !important;",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-vm-close-btn:hover {",
      "  background: rgba(220, 38, 38, 0.75) !important;",
      "  border-color: #f87171 !important;",
      "}",
      ".cluezy-vm-center {",
      "  flex: 1 1 auto !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  align-items: center !important;",
      "  justify-content: flex-start !important;",
      "  text-align: center !important;",
      "  max-width: 680px !important;",
      "  width: 100% !important;",
      "  margin: 0 auto !important;",
      "  user-select: none !important;",
      "  gap: 14px !important;",
      "  padding: 10px 4px !important;",
      "  overflow-y: auto !important;",
      "  min-height: 0 !important;",
      "}",
      ".cluezy-vm-state-badge {",
      "  padding: 6px 16px !important;",
      "  border-radius: 20px !important;",
      "  background: rgba(236, 246, 232, 0.14) !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.3) !important;",
      "  color: #ecf6e8 !important;",
      "  font-size: 12.5px !important;",
      "  font-weight: 600 !important;",
      "  letter-spacing: 0.04em !important;",
      "  text-transform: uppercase !important;",
      "}",
      ".cluezy-vm-orb-wrap {",
      "  position: relative !important;",
      "  width: 148px !important;",
      "  height: 148px !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  margin: 10px 0 !important;",
      "}",
      ".cluezy-vm-orb {",
      "  width: 96px !important;",
      "  height: 96px !important;",
      "  border-radius: 50% !important;",
      "  background: var(--clz-brand, #145C38) !important;",
      "  box-shadow: var(--clz-shadow) !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  z-index: 2 !important;",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-vm-orb-ring {",
      "  position: absolute !important;",
      "  inset: 12px !important;",
      "  border-radius: 50% !important;",
      "  border: 1px solid var(--clz-border-strong, #D1D5DB) !important;",
      "  opacity: 1 !important;",
      "}",
      ".cluezy-vm-overlay[data-vm-state='listening'] .cluezy-vm-orb-ring-1 {",
      "  border-color: var(--clz-brand, #145C38) !important;",
      "}",
      ".cluezy-vm-overlay[data-vm-state='listening'] .cluezy-vm-orb-ring-2 {",
      "  inset: 2px !important;",
      "  border-color: var(--clz-border, #E5E7EB) !important;",
      "}",
      ".cluezy-vm-overlay[data-vm-state='thinking'] .cluezy-vm-orb {",
      "  background: var(--clz-text-secondary, #4B5563) !important;",
      "}",
      ".cluezy-vm-overlay[data-vm-state='speaking'] .cluezy-vm-orb {",
      "  background: var(--clz-brand, #145C38) !important;",
      "}",
      ".cluezy-vm-waveform {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 5px !important;",
      "  height: 36px !important;",
      "}",
      ".cluezy-vm-waveform span {",
      "  width: 5px !important;",
      "  height: 14px !important;",
      "  border-radius: 4px !important;",
      "  background: #ffffff !important;",
      "  transition: height 0.2s ease !important;",
      "}",
      ".cluezy-vm-overlay[data-vm-state='listening'] .cluezy-vm-waveform span,",
      ".cluezy-vm-overlay[data-vm-state='speaking'] .cluezy-vm-waveform span {",
      "  animation: cluezy-wave-bar 0.9s infinite ease-in-out !important;",
      "}",
      ".cluezy-vm-waveform span:nth-child(2) { animation-delay: 0.15s !important; }",
      ".cluezy-vm-waveform span:nth-child(3) { animation-delay: 0.3s !important; }",
      ".cluezy-vm-waveform span:nth-child(4) { animation-delay: 0.45s !important; }",
      ".cluezy-vm-waveform span:nth-child(5) { animation-delay: 0.6s !important; }",
      "@keyframes cluezy-wave-bar {",
      "  0%, 100% { height: 10px; }",
      "  50% { height: 32px; }",
      "}",
      ".cluezy-vm-turn-card {",
      "  width: 100% !important;",
      "  max-width: 620px !important;",
      "  background: rgba(255, 255, 255, 0.07) !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.22) !important;",
      "  border-radius: 16px !important;",
      "  padding: 16px 18px !important;",
      "  box-sizing: border-box !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 14px !important;",
      "  text-align: left !important;",
      "}",
      ".cluezy-vm-turn-summary {",
      "  font-size: 13.5px !important;",
      "  font-weight: 500 !important;",
      "  line-height: 1.45 !important;",
      "  color: #a7f3d0 !important;",
      "}",
      ".cluezy-vm-turn-checklist,",
      ".cluezy-chat-turn-checklist {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 8px !important;",
      "}",
      ".cluezy-turn-check-item {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 6px !important;",
      "  padding: 10px 12px !important;",
      "  border-radius: 10px !important;",
      "  background: rgba(0, 0, 0, 0.22) !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.16) !important;",
      "}",
      ".cluezy-chat-turn-card .cluezy-turn-check-item {",
      "  background: #f7faf6 !important;",
      "  border: 1px solid #dfe5de !important;",
      "}",
      ".cluezy-turn-check-item.checked .cluezy-turn-check-title {",
      "  text-decoration: line-through !important;",
      "  opacity: 0.7 !important;",
      "}",
      ".cluezy-turn-check-label {",
      "  display: flex !important;",
      "  align-items: flex-start !important;",
      "  gap: 10px !important;",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-turn-check-cb {",
      "  width: 18px !important;",
      "  height: 18px !important;",
      "  margin-top: 2px !important;",
      "  accent-color: #145c38 !important;",
      "  cursor: pointer !important;",
      "  flex-shrink: 0 !important;",
      "}",
      ".cluezy-turn-check-title {",
      "  font-size: 13px !important;",
      "  font-weight: 600 !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-chat-turn-card .cluezy-turn-check-title {",
      "  color: #145c38 !important;",
      "}",
      ".cluezy-turn-check-detail {",
      "  font-size: 12.5px !important;",
      "  line-height: 1.4 !important;",
      "  color: rgba(236, 246, 232, 0.85) !important;",
      "  margin-top: 2px !important;",
      "}",
      ".cluezy-chat-turn-card .cluezy-turn-check-detail {",
      "  color: #374151 !important;",
      "}",
      ".cluezy-turn-cmd-bar {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: space-between !important;",
      "  gap: 8px !important;",
      "  background: rgba(0, 0, 0, 0.38) !important;",
      "  padding: 6px 10px !important;",
      "  border-radius: 7px !important;",
      "  margin-left: 28px !important;",
      "}",
      ".cluezy-chat-turn-card .cluezy-turn-cmd-bar {",
      "  background: #13251e !important;",
      "}",
      ".cluezy-turn-cmd-code {",
      "  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;",
      "  font-size: 12px !important;",
      "  color: #ecf6e8 !important;",
      "  word-break: break-all !important;",
      "}",
      ".cluezy-turn-cmd-copy {",
      "  border: 1px solid rgba(236, 246, 232, 0.35) !important;",
      "  background: rgba(20, 92, 56, 0.7) !important;",
      "  color: #ffffff !important;",
      "  border-radius: 6px !important;",
      "  padding: 3px 9px !important;",
      "  font-size: 11.5px !important;",
      "  font-weight: 600 !important;",
      "  cursor: pointer !important;",
      "  flex-shrink: 0 !important;",
      "}",
      ".cluezy-vm-turn-question {",
      "  font-size: 19px !important;",
      "  font-weight: 700 !important;",
      "  line-height: 1.4 !important;",
      "  color: #ffffff !important;",
      "}",
      ".cluezy-chat-turn-card {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 10px !important;",
      "  width: 100% !important;",
      "}",
      ".cluezy-chat-turn-summary {",
      "  font-size: 13px !important;",
      "  font-weight: 600 !important;",
      "  color: #145c38 !important;",
      "  background: #ecf6e8 !important;",
      "  padding: 6px 10px !important;",
      "  border-radius: 8px !important;",
      "}",
      ".cluezy-chat-turn-question {",
      "  font-size: 15.5px !important;",
      "  font-weight: 600 !important;",
      "  line-height: 1.45 !important;",
      "  color: #17251f !important;",
      "}",
      ".cluezy-vm-yousaid-row {",
      "  display: inline-flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  gap: 8px !important;",
      "  min-height: 28px !important;",
      "  padding: 4px 12px !important;",
      "  max-width: 580px !important;",
      "}",
      ".cluezy-vm-yousaid-text {",
      "  font-size: 13px !important;",
      "  font-weight: 500 !important;",
      "  color: rgba(236, 246, 232, 0.8) !important;",
      "}",
      ".cluezy-vm-yousaid-text.error {",
      "  color: #fca5a5 !important;",
      "}",
      ".cluezy-vm-yousaid-edit {",
      "  display: none;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  width: 28px !important;",
      "  height: 28px !important;",
      "  border-radius: 6px !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.35) !important;",
      "  background: rgba(255, 255, 255, 0.12) !important;",
      "  color: #ecf6e8 !important;",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-vm-options-pills {",
      "  display: flex !important;",
      "  flex-wrap: wrap !important;",
      "  justify-content: center !important;",
      "  gap: 8px !important;",
      "  max-width: 600px !important;",
      "}",
      ".cluezy-vm-opt-pill {",
      "  min-height: 44px !important;",
      "  padding: 8px 16px !important;",
      "  border-radius: 22px !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.35) !important;",
      "  background: rgba(20, 92, 56, 0.55) !important;",
      "  color: #ecf6e8 !important;",
      "  font-size: 13px !important;",
      "  font-weight: 500 !important;",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-vm-opt-pill:hover {",
      "  background: #145c38 !important;",
      "  border-color: #4ade80 !important;",
      "}",
      ".cluezy-vm-footer {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  align-items: center !important;",
      "  gap: 10px !important;",
      "  width: 100% !important;",
      "  max-width: 680px !important;",
      "  margin: 0 auto !important;",
      "}",
      ".cluezy-vm-action-btn {",
      "  min-height: 44px !important;",
      "  padding: 8px 18px !important;",
      "  border-radius: 10px !important;",
      "  border: 1px solid rgba(236, 246, 232, 0.4) !important;",
      "  background: rgba(255, 255, 255, 0.14) !important;",
      "  color: #ffffff !important;",
      "  font-weight: 600 !important;",
      "  font-size: 13px !important;",
      "  cursor: pointer !important;",
      "}",
      ".cluezy-vm-hint {",
      "  font-size: 12px !important;",
      "  color: rgba(236, 246, 232, 0.65) !important;",
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
      ".framer-QebP1.framer-6z3yif,",
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
      "[data-framer-name='solution content'],",
      "[data-framer-name='resolved content'],",
      "[data-framer-name='investigations content'],",
      "[data-framer-name='knowledge content'] {",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  height: 100vh !important;",
      "  max-height: 100vh !important;",
      "  padding: 24px 32px 36px 32px !important;",
      "  margin: 0 !important;",
      "  box-sizing: border-box !important;",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 18px !important;",
      "  overflow-y: auto !important;",
      "  overflow-x: hidden !important;",
      "  -webkit-overflow-scrolling: touch !important;",
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
      ".cluezy-typing-indicator {",
      "  opacity: 0.75;",
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
      "/* ==========================================================================",
      "   DYNAMIC RESPONSIVE & MOBILE-FIRST SYSTEM (All Screens & Devices)",
      "   ========================================================================== */",
      "/* 1. Prevent Framer SSR breakpoint classes from hiding critical content */",
      ".framer-xml8iz .ssr-variant.hidden-gl62q9,",
      ".framer-xml8iz .ssr-variant.hidden-1jnz3rc,",
      ".framer-ynmtwr .ssr-variant.hidden-1jnz3rc {",
      "  display: block !important;",
      "}",
      ".framer-1yyoi4g.hidden-87vn6v,",
      ".hidden-dyjihb {",
      "  display: flex !important;",
      "}",
      "/* 2. Mobile Top Navigation Bar & Backdrop (hidden on desktop > 1024px) */",
      ".cluezy-mobile-topbar {",
      "  display: none;",
      "}",
      ".cluezy-mobile-backdrop {",
      "  display: none;",
      "  position: fixed;",
      "  inset: 0;",
      "  background: rgba(7, 28, 19, 0.52);",
      "  backdrop-filter: blur(3px);",
      "  -webkit-backdrop-filter: blur(3px);",
      "  z-index: 100000;",
      "  opacity: 0;",
      "  transition: opacity 0.22s ease;",
      "}",
      "body.cluezy-mobile-sidebar-open .cluezy-mobile-backdrop,",
      "body.cluezy-mobile-context-open .cluezy-mobile-backdrop {",
      "  display: block;",
      "  opacity: 1;",
      "}",
      ".cluezy-sidebar-close-btn {",
      "  display: none;",
      "}",
      ".cluezy-context-sheet-header {",
      "  display: none;",
      "}",
      ".cluezy-inline-context-btn {",
      "  display: none;",
      "}",
      "/* 3. Tablet & Mobile Workspace Layout (<= 1024px) */",
      "@media (max-width: 1024px) {",
      "  /* Landing Page scrollable & stacked layout */",
      "  html:not(.cluezy-no-page-scroll),",
      "  body:not(.cluezy-no-page-scroll) {",
      "    height: auto !important;",
      "    min-height: 100vh !important;",
      "    max-height: none !important;",
      "    overflow-y: auto !important;",
      "    overflow-x: hidden !important;",
      "    -webkit-overflow-scrolling: touch !important;",
      "  }",
      "  body:not(.cluezy-no-page-scroll) #main,",
      "  .framer-8kiHx.framer-da9gk2 {",
      "    height: auto !important;",
      "    min-height: 100vh !important;",
      "    max-height: none !important;",
      "    overflow: visible !important;",
      "  }",
      "  .framer-TUnar.framer-72rtr7,",
      "  .framer-TUnar .framer-1k5d4r9 {",
      "    height: auto !important;",
      "    min-height: calc(100vh - 70px) !important;",
      "    max-height: none !important;",
      "    overflow: visible !important;",
      "  }",
      "  .framer-8kiHx .framer-15hwoiw {",
      "    height: auto !important;",
      "    min-height: 64px !important;",
      "    max-height: none !important;",
      "    padding: 12px 24px !important;",
      "    flex-wrap: wrap !important;",
      "    gap: 12px !important;",
      "  }",
      "  .framer-8kiHx .framer-krramk {",
      "    gap: 24px !important;",
      "  }",
      "  .framer-TUnar .framer-iwz5lk {",
      "    flex-direction: column !important;",
      "    align-items: center !important;",
      "    justify-content: flex-start !important;",
      "    text-align: center !important;",
      "    padding: 28px 24px 36px !important;",
      "    gap: 32px !important;",
      "    height: auto !important;",
      "    max-height: none !important;",
      "    overflow: visible !important;",
      "  }",
      "  .framer-TUnar .framer-xml8iz {",
      "    flex: none !important;",
      "    width: 100% !important;",
      "    max-width: 660px !important;",
      "    align-items: center !important;",
      "    text-align: center !important;",
      "  }",
      "  .framer-TUnar .framer-lgk7od h1 {",
      "    text-align: center !important;",
      "    font-size: clamp(28px, 4.8vw, 42px) !important;",
      "    line-height: 1.14 !important;",
      "  }",
      "  .framer-TUnar .framer-8lhi3e p {",
      "    text-align: center !important;",
      "    margin: 0 auto !important;",
      "  }",
      "  .framer-TUnar .framer-9fd05w {",
      "    justify-content: center !important;",
      "    flex-wrap: wrap !important;",
      "  }",
      "  .framer-TUnar .framer-ynmtwr {",
      "    flex: none !important;",
      "    width: 100% !important;",
      "    max-width: 460px !important;",
      "    height: auto !important;",
      "    min-height: 260px !important;",
      "    max-height: none !important;",
      "    margin: 0 auto !important;",
      "    padding: 8px 0 !important;",
      "  }",
      "  .framer-TUnar .framer-1n8j05n {",
      "    display: grid !important;",
      "    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)) !important;",
      "    gap: 16px !important;",
      "    padding: 24px !important;",
      "    height: auto !important;",
      "  }",
      "  .framer-TUnar .framer-r2nvad,",
      "  .framer-TUnar .framer-atl610,",
      "  .framer-TUnar .framer-kw4om,",
      "  .framer-TUnar .framer-9x1ues,",
      "  .framer-TUnar .framer-qlywa4 {",
      "    width: 100% !important;",
      "    background: #fcfbf9 !important;",
      "    border: 1px solid #dfe5de !important;",
      "    border-radius: 12px !important;",
      "    padding: 16px 14px !important;",
      "    box-sizing: border-box !important;",
      "  }",
      "  /* Workspace Pages: Mobile Top Bar & Slide-Out Drawer Sidebar */",
      "  .cluezy-mobile-topbar {",
      "    display: flex !important;",
      "    position: fixed !important;",
      "    top: 0 !important;",
      "    left: 0 !important;",
      "    right: 0 !important;",
      "    height: 56px !important;",
      "    background-color: var(--token-cPoBWZDTB, #073b27) !important;",
      "    color: #ffffff !important;",
      "    z-index: 99990 !important;",
      "    align-items: center !important;",
      "    justify-content: space-between !important;",
      "    padding: 0 14px !important;",
      "    box-sizing: border-box !important;",
      "    border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important;",
      "    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12) !important;",
      "  }",
      "  .cluezy-mobile-topbar-left {",
      "    display: flex !important;",
      "    align-items: center !important;",
      "    gap: 10px !important;",
      "  }",
      "  .cluezy-mobile-menu-btn {",
      "    background: rgba(255, 255, 255, 0.1) !important;",
      "    border: 1px solid rgba(255, 255, 255, 0.18) !important;",
      "    color: #ffffff !important;",
      "    width: 38px !important;",
      "    height: 38px !important;",
      "    border-radius: 8px !important;",
      "    display: inline-flex !important;",
      "    align-items: center !important;",
      "    justify-content: center !important;",
      "    cursor: pointer !important;",
      "    padding: 0 !important;",
      "    flex-shrink: 0 !important;",
      "  }",
      "  .cluezy-mobile-brand {",
      "    display: inline-flex !important;",
      "    align-items: center !important;",
      "    gap: 7px !important;",
      "    text-decoration: none !important;",
      "    cursor: pointer !important;",
      "  }",
      "  .cluezy-mobile-topbar-right {",
      "    display: flex !important;",
      "    align-items: center !important;",
      "    gap: 8px !important;",
      "  }",
      "  .cluezy-mobile-context-btn {",
      "    background: rgba(236, 246, 232, 0.15) !important;",
      "    border: 1px solid rgba(181, 221, 169, 0.45) !important;",
      "    color: #ecf6e8 !important;",
      "    height: 36px !important;",
      "    padding: 0 11px !important;",
      "    border-radius: 8px !important;",
      "    font-family: 'Inter', sans-serif !important;",
      "    font-size: 12px !important;",
      "    font-weight: 600 !important;",
      "    display: inline-flex !important;",
      "    align-items: center !important;",
      "    gap: 6px !important;",
      "    cursor: pointer !important;",
      "    white-space: nowrap !important;",
      "  }",
      "  .cluezy-mobile-context-badge {",
      "    background: #22c55e !important;",
      "    color: #052e16 !important;",
      "    font-size: 10.5px !important;",
      "    font-weight: 800 !important;",
      "    padding: 1px 6px !important;",
      "    border-radius: 10px !important;",
      "    line-height: 1.3 !important;",
      "  }",
      "  .cluezy-mobile-new-btn {",
      "    background: #145c38 !important;",
      "    border: 1px solid #22c55e !important;",
      "    color: #ffffff !important;",
      "    height: 36px !important;",
      "    padding: 0 11px !important;",
      "    border-radius: 8px !important;",
      "    font-family: 'Inter', sans-serif !important;",
      "    font-size: 12px !important;",
      "    font-weight: 600 !important;",
      "    display: inline-flex !important;",
      "    align-items: center !important;",
      "    gap: 4px !important;",
      "    cursor: pointer !important;",
      "    white-space: nowrap !important;",
      "  }",
      "  /* Remove permanent 230px sidebar offset on <= 1024px */",
      "  body.cluezy-no-page-scroll [data-layout-template='true'],",
      "  [data-layout-template='true'],",
      "  .framer-sbem9.framer-n22pd4 {",
      "    padding: 56px 0 0 0 !important;",
      "    width: 100vw !important;",
      "    max-width: 100vw !important;",
      "    height: 100vh !important;",
      "    height: 100dvh !important;",
      "    max-height: 100dvh !important;",
      "  }",
      "  /* Off-canvas Sidebar Drawer */",
      "  [data-framer-name='Sidebar'],",
      "  .framer-sbem9 .framer-r5haeu {",
      "    position: fixed !important;",
      "    left: 0 !important;",
      "    top: 0 !important;",
      "    bottom: 0 !important;",
      "    width: 270px !important;",
      "    min-width: 270px !important;",
      "    max-width: 84vw !important;",
      "    height: 100vh !important;",
      "    height: 100dvh !important;",
      "    max-height: 100dvh !important;",
      "    z-index: 100005 !important;",
      "    transform: translateX(-105%) !important;",
      "    transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1) !important;",
      "    box-shadow: 6px 0 28px rgba(0, 0, 0, 0.4) !important;",
      "  }",
      "  body.cluezy-mobile-sidebar-open [data-framer-name='Sidebar'],",
      "  body.cluezy-mobile-sidebar-open .framer-sbem9 .framer-r5haeu {",
      "    transform: translateX(0) !important;",
      "  }",
      "  .cluezy-sidebar-close-btn {",
      "    display: inline-flex !important;",
      "    align-items: center !important;",
      "    justify-content: center !important;",
      "    position: absolute !important;",
      "    top: 14px !important;",
      "    right: 12px !important;",
      "    width: 32px !important;",
      "    height: 32px !important;",
      "    border-radius: 7px !important;",
      "    background: rgba(255, 255, 255, 0.1) !important;",
      "    border: 1px solid rgba(255, 255, 255, 0.18) !important;",
      "    color: #ffffff !important;",
      "    cursor: pointer !important;",
      "    z-index: 10 !important;",
      "  }",
      "  /* Adjust Workspace Main Content Height for 56px Top Bar */",
      "  .framer-xyKMK.framer-ypbln3,",
      "  .framer-BxVAd.framer-1g3woon,",
      "  .framer-EQe3b.framer-3ap5fj,",
      "  .framer-fnZmG.framer-1remmab,",
      "  .framer-QebP1.framer-6z3yif,",
      "  [data-framer-root] {",
      "    width: 100% !important;",
      "    max-width: 100% !important;",
      "    height: calc(100vh - 56px) !important;",
      "    height: calc(100dvh - 56px) !important;",
      "    max-height: calc(100dvh - 56px) !important;",
      "  }",
      "  [data-framer-name='investigation content'],",
      "  .framer-xyKMK .framer-nbz4r4 {",
      "    height: calc(100vh - 56px) !important;",
      "    height: calc(100dvh - 56px) !important;",
      "    max-height: calc(100dvh - 56px) !important;",
      "    padding: 12px 16px !important;",
      "    gap: 10px !important;",
      "  }",
      "  [data-framer-name='solution content'],",
      "  [data-framer-name='resolved content'],",
      "  [data-framer-name='investigations content'],",
      "  [data-framer-name='knowledge content'] {",
      "    height: calc(100vh - 56px) !important;",
      "    height: calc(100dvh - 56px) !important;",
      "    max-height: calc(100dvh - 56px) !important;",
      "    padding: 18px 16px 32px 16px !important;",
      "    gap: 16px !important;",
      "  }",
      "  /* Slide-Up Bottom Sheet for Right-Hand Investigation Context on <= 1024px */",
      "  [data-framer-name='Investigation context'],",
      "  .framer-xyKMK .framer-1qpwm9z {",
      "    position: fixed !important;",
      "    left: 0 !important;",
      "    right: 0 !important;",
      "    bottom: 0 !important;",
      "    width: 100% !important;",
      "    min-width: 100% !important;",
      "    max-width: 100% !important;",
      "    flex: none !important;",
      "    height: auto !important;",
      "    max-height: 80vh !important;",
      "    max-height: 80dvh !important;",
      "    border-radius: 20px 20px 0 0 !important;",
      "    border-top: 2px solid #145c38 !important;",
      "    z-index: 100004 !important;",
      "    transform: translateY(105%) !important;",
      "    transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1) !important;",
      "    box-shadow: 0 -10px 35px rgba(0, 0, 0, 0.25) !important;",
      "    padding: 14px 18px 28px 18px !important;",
      "  }",
      "  body.cluezy-mobile-context-open [data-framer-name='Investigation context'],",
      "  body.cluezy-mobile-context-open .framer-xyKMK .framer-1qpwm9z {",
      "    transform: translateY(0) !important;",
      "  }",
      "  .cluezy-context-sheet-header {",
      "    display: flex !important;",
      "    align-items: center !important;",
      "    justify-content: space-between !important;",
      "    width: 100% !important;",
      "    padding-bottom: 10px !important;",
      "    margin-bottom: 4px !important;",
      "    border-bottom: 1px solid #dfe5de !important;",
      "  }",
      "  .cluezy-context-sheet-title {",
      "    font-family: 'Inter', sans-serif !important;",
      "    font-size: 14px !important;",
      "    font-weight: 700 !important;",
      "    color: #145c38 !important;",
      "    display: flex !important;",
      "    align-items: center !important;",
      "    gap: 6px !important;",
      "  }",
      "  .cluezy-context-sheet-close {",
      "    background: #ecf6e8 !important;",
      "    border: 1px solid #b5dda9 !important;",
      "    color: #145c38 !important;",
      "    border-radius: 6px !important;",
      "    padding: 4px 10px !important;",
      "    font-family: 'Inter', sans-serif !important;",
      "    font-size: 12px !important;",
      "    font-weight: 600 !important;",
      "    cursor: pointer !important;",
      "  }",
      "  .cluezy-inline-context-btn {",
      "    display: inline-flex !important;",
      "    align-items: center !important;",
      "    gap: 5px !important;",
      "    background: #ecf6e8 !important;",
      "    border: 1px solid #145c38 !important;",
      "    color: #145c38 !important;",
      "    border-radius: 20px !important;",
      "    padding: 4px 10px !important;",
      "    font-family: 'Inter', sans-serif !important;",
      "    font-size: 11.5px !important;",
      "    font-weight: 600 !important;",
      "    cursor: pointer !important;",
      "  }",
      "}",
      "/* 4. Mobile Phone Breakpoint (<= 768px) */",
      "@media (max-width: 768px) {",
      "  /* Landing Navbar compact 2-row grid */",
      "  .framer-8kiHx .framer-15hwoiw {",
      "    padding: 10px 14px !important;",
      "    gap: 8px !important;",
      "  }",
      "  .framer-8kiHx .framer-o7hoit img:first-child {",
      "    height: 28px !important;",
      "  }",
      "  .framer-8kiHx .framer-o7hoit img:last-child {",
      "    height: 18px !important;",
      "  }",
      "  .framer-8kiHx .framer-1yyoi4g {",
      "    margin-left: auto !important;",
      "  }",
      "  .cluezy-google-btn,",
      "  .cluezy-header-profile-pill {",
      "    min-width: 0 !important;",
      "    padding: 8px 12px !important;",
      "    font-size: 12.5px !important;",
      "    gap: 7px !important;",
      "  }",
      "  .framer-8kiHx .framer-krramk {",
      "    order: 3 !important;",
      "    width: 100% !important;",
      "    justify-content: space-around !important;",
      "    gap: 10px !important;",
      "    padding-top: 8px !important;",
      "    border-top: 1px solid rgba(20, 92, 56, 0.1) !important;",
      "  }",
      "  .framer-8kiHx .framer-1ytts1e p,",
      "  .framer-8kiHx .framer-u1406l p,",
      "  .framer-8kiHx .framer-1o2suav p {",
      "    font-size: 13.5px !important;",
      "  }",
      "  /* Landing Hero & Laptop on Mobile */",
      "  .framer-TUnar .framer-iwz5lk {",
      "    padding: 18px 16px 24px !important;",
      "    gap: 22px !important;",
      "  }",
      "  .framer-TUnar .framer-lgk7od h1 {",
      "    font-size: clamp(24px, 6.8vw, 32px) !important;",
      "    line-height: 1.16 !important;",
      "  }",
      "  .framer-TUnar .framer-8lhi3e p {",
      "    font-size: 14px !important;",
      "    line-height: 1.5 !important;",
      "  }",
      "  .framer-TUnar .framer-9fd05w {",
      "    flex-direction: column !important;",
      "    width: 100% !important;",
      "    max-width: 340px !important;",
      "    gap: 10px !important;",
      "  }",
      "  .framer-TUnar .framer-142crrb-container,",
      "  .framer-TUnar .framer-1s95o7a-container {",
      "    width: 100% !important;",
      "  }",
      "  .framer-TUnar .framer-142crrb-container a,",
      "  .framer-TUnar .framer-1s95o7a-container a {",
      "    width: 100% !important;",
      "    display: flex !important;",
      "    justify-content: center !important;",
      "    padding: 12px 20px !important;",
      "    box-sizing: border-box !important;",
      "  }",
      "  .framer-TUnar .framer-ynmtwr {",
      "    min-height: 210px !important;",
      "    max-width: 100% !important;",
      "    flex-direction: column !important;",
      "  }",
      "  .framer-TUnar .framer-1lwd1d4 {",
      "    width: 92% !important;",
      "    max-width: 330px !important;",
      "    height: 200px !important;",
      "    left: 4% !important;",
      "    top: 0 !important;",
      "    transform: rotate(-4deg) !important;",
      "  }",
      "  .framer-TUnar .framer-1aeb716 {",
      "    transform: none !important;",
      "    width: 100% !important;",
      "    max-width: 335px !important;",
      "    height: auto !important;",
      "    min-height: 175px !important;",
      "    padding: 16px 14px !important;",
      "    border-width: 8px !important;",
      "    margin: 0 auto !important;",
      "    position: relative !important;",
      "    left: auto !important;",
      "    top: auto !important;",
      "  }",
      "  .framer-TUnar .framer-17vx2y0 {",
      "    transform: none !important;",
      "    width: 96% !important;",
      "    max-width: 350px !important;",
      "    height: 12px !important;",
      "    margin: 0 auto !important;",
      "    position: relative !important;",
      "    left: auto !important;",
      "    top: auto !important;",
      "  }",
      "  .framer-TUnar .framer-1n8j05n {",
      "    grid-template-columns: repeat(2, 1fr) !important;",
      "    gap: 12px !important;",
      "    padding: 16px 14px 28px !important;",
      "  }",
      "  /* Workspace Investigation Heading & Chat on Mobile */",
      "  [data-framer-name='Investigation heading'],",
      "  .framer-xyKMK .framer-1yyitid {",
      "    flex-wrap: wrap !important;",
      "    gap: 8px !important;",
      "  }",
      "  [data-framer-name='Investigation heading'] h2 {",
      "    font-size: 16.5px !important;",
      "  }",
      "  .cluezy-heading-actions {",
      "    gap: 6px !important;",
      "    flex-wrap: wrap !important;",
      "  }",
      "  .cluezy-header-user-name {",
      "    max-width: 80px !important;",
      "  }",
      "  .cluezy-new-investigation-layout {",
      "    padding: 14px 6px 28px !important;",
      "  }",
      "  .cluezy-hero-title {",
      "    font-size: 20px !important;",
      "  }",
      "  .cluezy-hero-subtitle {",
      "    font-size: 12.5px !important;",
      "  }",
      "  .cluezy-starter-categories {",
      "    flex-wrap: nowrap !important;",
      "    justify-content: flex-start !important;",
      "    overflow-x: auto !important;",
      "    padding-bottom: 6px !important;",
      "    margin-top: 14px !important;",
      "    -webkit-overflow-scrolling: touch !important;",
      "  }",
      "  .cluezy-starter-card {",
      "    padding: 10px 12px !important;",
      "  }",
      "  .cluezy-starter-card-label {",
      "    font-size: 12.5px !important;",
      "  }",
      "  /* Prevent iOS zoom on input focus by using 16px font on mobile */",
      "  .cluezy-chat-textarea,",
      "  .cluezy-search-input,",
      "  .cluezy-hero-input {",
      "    font-size: 16px !important;",
      "  }",
      "  .framer-xyKMK .framer-vu1os6 {",
      "    max-width: 90% !important;",
      "    padding: 12px 14px !important;",
      "  }",
      "  .framer-xyKMK .framer-wvffk8 {",
      "    padding: 14px 15px !important;",
      "  }",
      "  [data-framer-name='Conversation'],",
      "  .framer-xyKMK .framer-1f6swql {",
      "    padding-right: 2px !important;",
      "    gap: 12px !important;",
      "  }",
      "  /* Investigations History list on Mobile */",
      "  .framer-EQe3b .framer-18etrkb {",
      "    flex-direction: column !important;",
      "    align-items: stretch !important;",
      "    gap: 10px !important;",
      "  }",
      "  .framer-EQe3b .framer-1nkaxif {",
      "    width: 100% !important;",
      "    flex: none !important;",
      "  }",
      "  .cluezy-category-tabs {",
      "    width: 100% !important;",
      "    display: flex !important;",
      "  }",
      "  .cluezy-category-tab {",
      "    flex: 1 1 50% !important;",
      "    text-align: center !important;",
      "  }",
      "  .framer-EQe3b .framer-1xep79e,",
      "  .framer-EQe3b .framer-94geo0,",
      "  .framer-EQe3b .framer-15h09tb {",
      "    padding: 14px !important;",
      "    gap: 12px !important;",
      "    flex-wrap: wrap !important;",
      "  }",
      "  /* Solution & Resolved pages on Mobile */",
      "  .framer-BxVAd .framer-146hex6,",
      "  .framer-BxVAd .framer-p2z1ts,",
      "  .framer-fnZmG .framer-v42pep {",
      "    padding: 16px !important;",
      "  }",
      "  .framer-fnZmG .framer-1uqe61t {",
      "    padding: 12px 0 !important;",
      "  }",
      "  .framer-BxVAd .framer-xjpebi,",
      "  .framer-fnZmG .framer-1gl26h2 {",
      "    flex-direction: column !important;",
      "    align-items: stretch !important;",
      "    gap: 10px !important;",
      "  }",
      "  .framer-BxVAd .framer-xjpebi > div,",
      "  .framer-fnZmG .framer-1gl26h2 > div {",
      "    width: 100% !important;",
      "  }",
      "  .framer-BxVAd .framer-xjpebi a,",
      "  .framer-fnZmG .framer-1gl26h2 a {",
      "    width: 100% !important;",
      "    display: flex !important;",
      "    justify-content: center !important;",
      "    box-sizing: border-box !important;",
      "    padding: 12px 16px !important;",
      "  }",
      "}",
      "@media (max-width: 480px) {",
      "  .framer-TUnar .framer-1n8j05n {",
      "    grid-template-columns: 1fr !important;",
      "  }",
      "  .cluezy-header-auth-slot .cluezy-header-user-name {",
      "    display: none !important;",
      "  }",
      "}",
    ].join("\n");
    var uiCssLink = document.querySelector('link[href*="cluezy-ui.css"]');
    if (uiCssLink && uiCssLink.parentNode) {
      uiCssLink.parentNode.insertBefore(style, uiCssLink);
    } else {
      document.head.appendChild(style);
    }
  }

  /**
   * Navigate cleanly to an application route with optional query parameters.
   */
  function navigateTo(routePath, queryParams) {
    // Stop any active recognition or speech synthesis before leaving page
    CluezyVoiceMode.closeOverlay();
    CluezyVoice.stopRecording();
    CluezyVoice.stopSpeaking();
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
        emptyEl.className = "cluezy-recent-empty";
        emptyEl.textContent = "No recent investigations";
        list.appendChild(emptyEl);
      } else {
        recentItems.forEach(function (item) {
          var rawTitle = (item.title || item.problem_description || item.reference_id || "Investigation").trim();
          var relTime = formatRelativeTime(item.created_at || item.updated_at);
          var isCurrentItem =
            appState.currentInvestigation &&
            appState.currentInvestigation.reference_id === item.reference_id;

          var a = document.createElement("a");
          a.className = "cluezy-recent-item" + (isCurrentItem ? " active" : "");
          a.setAttribute("href", "/investigation/?id=" + encodeURIComponent(item.reference_id));
          a.setAttribute("title", rawTitle);
          a.innerHTML =
            '<span class="cluezy-title" title="' + escapeHtml(rawTitle) + '">' + escapeHtml(rawTitle) + "</span>" +
            '<span class="cluezy-time">' + escapeHtml(relTime) + "</span>";

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
    var path = window.location.pathname || "/";
    var isHistoryPage = path.indexOf("/investigations") === 0;
    var isInvestigationPage = path.indexOf("/investigation") === 0 && !isHistoryPage;

    var newInvLinks = document.querySelectorAll('[data-framer-name="Sidebar"] [data-framer-name="New Investigation"]');
    newInvLinks.forEach(function (el) {
      var anchor = el.tagName === "A" ? el : el.closest("a");
      if (anchor) {
        if (isInvestigationPage) anchor.classList.add("cluezy-nav-link-active");
        else anchor.classList.remove("cluezy-nav-link-active");
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
        if (isHistoryPage) anchor.classList.add("cluezy-nav-link-active");
        else anchor.classList.remove("cluezy-nav-link-active");
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
        wrap.innerHTML = '<img src="/images/logo.png" alt="CLUEZY" style="height: 26px; width: auto; object-fit: contain; flex-shrink: 0;" /><img src="/images/text.png" alt="CLUEZY" style="height: 16px; width: auto; object-fit: contain; flex-shrink: 0;" />';
        el.appendChild(wrap);
      }
    });

    // Render Recent Investigations immediately on mount, then update when API resolves
    renderSidebarRecentInvestigations(appState.investigationsList || []);
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
   * Remove duplicate sidebar navigation logout button (Avatar menu in header contains the only Logout).
   */
  function renderSidebarLogoutButton() {
    var navs = document.querySelectorAll('[data-framer-name="Workspace navigation"]');
    navs.forEach(function (nav) {
      var existing = nav.querySelector(".cluezy-nav-logout-btn");
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    });
  }

  function renderTokenQuota(sess) {
    var usageBoxes = document.querySelectorAll('[data-framer-name="Free plan usage"]');
    if (!usageBoxes || !usageBoxes.length) return;
    var remPct = sess && sess.remaining_percentage !== undefined ? Math.round(sess.remaining_percentage) : 100;
    var usedPct = Math.max(0, Math.min(100, 100 - remPct));
    if (sess && typeof sess.tokens_used === "number" && typeof sess.daily_token_limit === "number" && sess.daily_token_limit > 0) {
      usedPct = Math.max(0, Math.min(100, Math.round((sess.tokens_used / sess.daily_token_limit) * 100)));
    }
    usageBoxes.forEach(function (usageBox) {
      var textContainer = usageBox.querySelector(".framer-ff8y6p span, .framer-ff8y6p p");
      if (textContainer) {
        textContainer.textContent = "Daily usage: " + usedPct + "%";
      }
      var bar = usageBox.querySelector('[data-framer-name="Remaining allowance"]');
      if (bar) {
        bar.style.width = usedPct + "%";
      }
    });
  }

  /**
   * Bind sidebar bottom row: ONE combined avatar/usage row at the bottom of the sidebar.
   * Preserves [data-framer-name="Profile"], [data-framer-name="Free plan usage"],
   * .framer-ff8y6p, and [data-framer-name="Remaining allowance"] in the DOM.
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
      var oldMenu = document.getElementById("cluezy-account-dropdown");
      if (oldMenu && oldMenu.parentNode) {
        oldMenu.parentNode.removeChild(oldMenu);
      }

      var sidebar = profileEl.closest('[data-framer-name="Sidebar"]');
      var usageBox = sidebar ? sidebar.querySelector('[data-framer-name="Free plan usage"]') : null;

      profileEl.style.display = "flex";
      profileEl.classList.add("cluezy-sidebar-bottom-row");

      var metadata = (user && user.user_metadata) || {};
      var displayName = user
        ? (metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "User"))
        : "Guest";
      var avatarUrl = user ? (metadata.avatar_url || metadata.picture || null) : null;
      var initial = (displayName.charAt(0) || "G").toUpperCase();

      var avatarHtml = avatarUrl
        ? '<img src="' + avatarUrl + '" alt="' + escapeHtml(displayName) + '" class="cluezy-sidebar-avatar-img" referrerpolicy="no-referrer" />'
        : '<div class="cluezy-sidebar-avatar-initial">' + escapeHtml(initial) + "</div>";

      var rightActionHtml = !user
        ? '<button class="cluezy-sidebar-signin-btn" title="Sign in with Google" type="button">Sign in</button>'
        : "";

      // Detach usageBox temporarily before setting innerHTML so it is never destroyed
      if (usageBox && profileEl.contains(usageBox)) {
        profileEl.removeChild(usageBox);
      }

      profileEl.innerHTML =
        '<div class="cluezy-profile-card-inner">' +
          '<div class="cluezy-sidebar-avatar-wrap">' + avatarHtml + "</div>" +
          '<div class="cluezy-sidebar-profile-col">' +
            '<div class="cluezy-sidebar-profile-top">' +
              '<span class="cluezy-sidebar-user-name">' + escapeHtml(displayName) + "</span>" +
              rightActionHtml +
            "</div>" +
            '<div class="cluezy-sidebar-usage-slot"></div>' +
          "</div>" +
        "</div>";

      var usageSlot = profileEl.querySelector(".cluezy-sidebar-usage-slot");
      if (usageBox && usageSlot) {
        usageSlot.appendChild(usageBox);
      }

      var signinBtn = profileEl.querySelector(".cluezy-sidebar-signin-btn");
      if (signinBtn) {
        signinBtn.onclick = function (e) {
          e.stopPropagation();
          API.signInWithGoogle();
        };
      }
    });

    var cachedSess = API.getCachedSessionData();
    renderTokenQuota(cachedSess || { remaining_percentage: 100 });

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

    // Header Voice Controls: Single primary "Voice Mode" button + Settings icon popover
    renderHeaderVoiceControls(actionsContainer, authSlot);

    var user = null;
    try {
      user = await API.getAuthUser();
    } catch (_e) {
      user = null;
    }

    var metadata = (user && user.user_metadata) || {};
    var displayName = user
      ? (metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "User"))
      : "Guest";
    var avatarUrl = user ? (metadata.avatar_url || metadata.picture || null) : null;
    var initial = (displayName.charAt(0) || "G").toUpperCase();
    var avatarHtml = avatarUrl
      ? '<img class="cluezy-header-avatar" src="' + avatarUrl + '" alt="' + escapeHtml(displayName) + '" referrerpolicy="no-referrer" />'
      : '<div class="cluezy-header-avatar-initial">' + escapeHtml(initial) + '</div>';

    var chevronSvg = (window.lucide && window.lucide.svg)
      ? window.lucide.svg("chevron-down", { size: 14 })
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    authSlot.innerHTML =
      '<button type="button" class="cluezy-header-auth-pill" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false" title="Account menu">' +
        avatarHtml +
        '<span class="cluezy-header-user-name">' + escapeHtml(displayName) + '</span>' +
        chevronSvg +
      '</button>';

    var avatarBtn = authSlot.querySelector(".cluezy-header-auth-pill");
    if (avatarBtn) {
      avatarBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleAccountDropdown(avatarBtn, user, root);
      };
    }
  }

  function toggleAccountDropdown(anchorEl, user, rootEl) {
    var existing = document.getElementById("cluezy-account-dropdown");
    if (existing) {
      existing.parentNode.removeChild(existing);
      anchorEl.setAttribute("aria-expanded", "false");
      return;
    }

    // Close settings popover if open
    var openSettings = document.getElementById("cluezy-settings-popover");
    if (openSettings) openSettings.classList.remove("open");

    anchorEl.setAttribute("aria-expanded", "true");
    var rect = anchorEl.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.id = "cluezy-account-dropdown";
    menu.className = "cluezy-avatar-menu-popover";
    menu.setAttribute("role", "menu");
    menu.style.top = (rect.bottom + 8) + "px";
    menu.style.right = Math.max(16, window.innerWidth - rect.right) + "px";

    var metadata = (user && user.user_metadata) || {};
    var displayName = user
      ? (metadata.full_name || metadata.name || (user.email ? user.email.split("@")[0] : "Account"))
      : "Anonymous Session";
    var email = (user && user.email) || "Not signed in";

    var logoutIcon = (window.lucide && window.lucide.svg)
      ? window.lucide.svg("log-out", { size: 14 })
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';

    var signInRowHtml = !user
      ? '<button type="button" class="cluezy-header-signin-btn cluezy-menu-signin-btn" role="menuitem">' +
          '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.3 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.8s.7 5.1 1.9 7.5l3.7-2.9z"/><path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.4 7.5 23 12 23z"/></svg>' +
          '<span>Sign in with Google</span>' +
        '</button>'
      : "";

    menu.innerHTML =
      '<div class="cluezy-avatar-menu-header">' +
      '  <div class="cluezy-avatar-menu-name">' + escapeHtml(displayName) + '</div>' +
      '  <div class="cluezy-avatar-menu-email">' + escapeHtml(email) + '</div>' +
      '</div>' +
      signInRowHtml +
      '<button type="button" id="cluezy-logout-btn" class="cluezy-header-logout-btn" role="menuitem">' +
        logoutIcon +
        '<span>Log out</span>' +
      '</button>';

    document.body.appendChild(menu);

    var signinBtn = menu.querySelector(".cluezy-header-signin-btn");
    if (signinBtn) {
      signinBtn.onclick = function (e) {
        e.stopPropagation();
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        API.signInWithGoogle();
      };
    }

    var logoutBtn = menu.querySelector("#cluezy-logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = async function (e) {
        e.stopPropagation();
        logoutBtn.disabled = true;
        logoutBtn.textContent = "Logging out…";
        try {
          await API.signOut();
        } catch (_e) {}
        try {
          localStorage.removeItem("cluezy_anonymous_session_token");
          localStorage.removeItem("cluezy_anonymous_session_id");
        } catch (_e) {}
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        if (user) {
          bindUserProfile();
          if (rootEl) renderInvestigationHeadingAuth(rootEl);
          API.listInvestigations({ page: 1, page_size: 5 })
            .then(function (res) {
              if (res && Array.isArray(res.items)) {
                renderSidebarRecentInvestigations(res.items);
              }
            })
            .catch(function () {});
        } else {
          window.location.href = "/";
        }
      };
    }

    function onDocClick(e) {
      if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        anchorEl.setAttribute("aria-expanded", "false");
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
  function createChatBubbleDOM(sender, contentText, timestampText, msgObj) {
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

      var pres = msgObj ? CluezyVoice.getMessagePresentation(msgObj) : null;

      // Render structured Turn Card if TurnPresentation is present; otherwise fallback to standard paragraphs for backward compatibility
      if (pres && pres.summary && pres.question) {
        var turnCard = document.createElement("div");
        turnCard.className = "cluezy-chat-turn-card";

        var summaryDiv = document.createElement("div");
        summaryDiv.className = "cluezy-chat-turn-summary";
        summaryDiv.textContent = pres.summary;
        turnCard.appendChild(summaryDiv);

        var checksList = Array.isArray(pres.checks) ? pres.checks : [];
        if (checksList.length > 0) {
          var checklistDiv = document.createElement("div");
          checklistDiv.className = "cluezy-chat-turn-checklist";
          checksList.forEach(function (chk, idx) {
            var chkKey = "chat_chk_" + (msgObj && msgObj.id ? msgObj.id : "") + "_" + idx;
            var isChecked = Boolean(appState.checkedChecklistKeys[chkKey]);

            var row = document.createElement("div");
            row.className = "cluezy-turn-check-item" + (isChecked ? " checked" : "");

            var labelWrap = document.createElement("label");
            labelWrap.className = "cluezy-turn-check-label";

            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "cluezy-turn-check-cb";
            cb.checked = isChecked;
            cb.addEventListener("change", function () {
              appState.checkedChecklistKeys[chkKey] = cb.checked;
              if (cb.checked) row.classList.add("checked");
              else row.classList.remove("checked");
            });

            var textCol = document.createElement("div");
            textCol.className = "cluezy-turn-check-text";
            var titleStrong = document.createElement("div");
            titleStrong.className = "cluezy-turn-check-title";
            titleStrong.textContent = (idx + 1) + ". " + (chk.title || "Check");
            var detailSpan = document.createElement("div");
            detailSpan.className = "cluezy-turn-check-detail";
            detailSpan.textContent = chk.detail || "";
            textCol.appendChild(titleStrong);
            textCol.appendChild(detailSpan);

            labelWrap.appendChild(cb);
            labelWrap.appendChild(textCol);
            row.appendChild(labelWrap);

            if (chk.command) {
              var cmdBar = document.createElement("div");
              cmdBar.className = "cluezy-turn-cmd-bar";
              var codeEl = document.createElement("code");
              codeEl.className = "cluezy-turn-cmd-code";
              codeEl.textContent = chk.command;

              var copyBtn = document.createElement("button");
              copyBtn.type = "button";
              copyBtn.className = "cluezy-turn-cmd-copy";
              copyBtn.textContent = "Copy";
              copyBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(chk.command).then(function () {
                    copyBtn.textContent = "Copied ✓";
                    setTimeout(function () {
                      copyBtn.textContent = "Copy";
                    }, 1500);
                  });
                }
              });

              cmdBar.appendChild(codeEl);
              cmdBar.appendChild(copyBtn);
              row.appendChild(cmdBar);
            }

            checklistDiv.appendChild(row);
          });
          turnCard.appendChild(checklistDiv);
        }

        var questionDiv = document.createElement("div");
        questionDiv.className = "cluezy-chat-turn-question";
        questionDiv.textContent = pres.question.text || contentText;
        turnCard.appendChild(questionDiv);

        botCard.appendChild(turnCard);
      } else {
        // Backward compatibility for legacy messages without presentation
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
      }

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
    { id: "all", label: "Popular", icon: "sparkles" },
    { id: "network", label: "Network & Wi-Fi", icon: "wifi" },
    { id: "hardware", label: "Hardware & System", icon: "cpu" },
    { id: "audio", label: "Audio & Video", icon: "volume-2" },
    { id: "software", label: "Software & Apps", icon: "app-window" },
    { id: "dev", label: "Dev & Database", icon: "database" },
  ];

  var STARTER_PROMPTS_BY_CATEGORY = {
    all: [
      {
        icon: "wifi-off",
        label: "Wi-Fi connected but websites won't open",
        prompt:
          "My Windows laptop is connected to Wi-Fi but websites aren't opening, though my phone works fine on the same network.",
      },
      {
        icon: "mic-off",
        label: "Zoom / Teams does not detect USB microphone",
        prompt:
          "Zoom says no microphone detected, but my USB microphone is plugged in and works in other apps.",
      },
      {
        icon: "cpu",
        label: "Laptop freezing with 100% Disk / CPU usage",
        prompt:
          "My laptop keeps freezing and Task Manager shows 100% disk and CPU usage even when no apps are running.",
      },
      {
        icon: "database",
        label: "PostgreSQL connection refused on port 5432",
        prompt:
          "My backend application cannot connect to the PostgreSQL database, showing connection refused on 127.0.0.1:5432.",
      },
    ],
    network: [
      {
        icon: "wifi-off",
        label: "Wi-Fi says No Internet (169.254 APIPA address)",
        prompt:
          "My Windows laptop is connected to Wi-Fi with no internet access. I ran ipconfig and my IPv4 address starts with 169.254.",
      },
      {
        icon: "globe",
        label: "DNS server not responding on Windows / Mac",
        prompt:
          "Websites won't load and Windows network troubleshooter reports 'Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding'.",
      },
      {
        icon: "router",
        label: "All devices on Wi-Fi have no internet access",
        prompt:
          "My laptop and all other devices and phones on the Wi-Fi have no internet. The router lights are blinking amber/orange.",
      },
      {
        icon: "cable",
        label: "Ethernet connected but says Unidentified Network",
        prompt:
          "My PC is plugged in via Ethernet cable, but Windows shows 'Unidentified Network - No Internet Access'.",
      },
    ],
    hardware: [
      {
        icon: "laptop",
        label: "Laptop shuts down when running heavy apps",
        prompt:
          "My laptop suddenly shuts off without warning when gaming or running intensive applications. The bottom fan feels extremely hot.",
      },
      {
        icon: "monitor",
        label: "External monitor not detected over HDMI / USB-C",
        prompt:
          "Windows Display Settings says 'Didn't detect another display' when plugging in my external monitor via HDMI.",
      },
      {
        icon: "battery-warning",
        label: "Laptop battery draining fast in sleep mode",
        prompt:
          "My laptop battery drops 40% overnight even when the lid is closed and the computer is in sleep mode.",
      },
      {
        icon: "cpu",
        label: "High RAM usage causing system freeze",
        prompt:
          "Task Manager shows 95% RAM in use even with only a few browser tabs open, causing the entire computer to lag.",
      },
    ],
    audio: [
      {
        icon: "mic-off",
        label: "Zoom / Teams says 'No microphone detected'",
        prompt:
          "During Zoom meetings, the microphone is muted and settings say 'Cannot detect your microphone' even though permissions are granted.",
      },
      {
        icon: "headphones",
        label: "Bluetooth headphones paired but audio on speakers",
        prompt:
          "My Bluetooth headphones are connected in Windows settings, but audio still comes out of the laptop speakers.",
      },
      {
        icon: "volume-x",
        label: "Microphone volume is extremely low or muffled",
        prompt:
          "Other people in Discord and Google Meet can barely hear me because my microphone volume is too low despite max volume in settings.",
      },
      {
        icon: "alert-circle",
        label: "USB audio device not recognized",
        prompt:
          "When plugging in my USB headset/mic, Windows says 'USB device not recognized (Device Descriptor Request Failed)'.",
      },
    ],
    software: [
      {
        icon: "app-window",
        label: "Application crashes on launch with no error",
        prompt:
          "When I click to open my application, the loading spinner appears for two seconds and then disappears without opening or showing an error.",
      },
      {
        icon: "shield-alert",
        label: "Software installer fails with error 2503 / 2502",
        prompt:
          "Running the installer fails with 'The installer has encountered an unexpected error installing this package. Code 2503 / 2502'.",
      },
      {
        icon: "refresh-cw",
        label: "Windows Update stuck installing at 100%",
        prompt:
          "Windows Update has been stuck at 100% installing for over two hours and restarting doesn't fix it.",
      },
      {
        icon: "globe",
        label: "Browser shows ERR_CONNECTION_REFUSED",
        prompt:
          "Every website I try to open in Chrome shows ERR_CONNECTION_REFUSED, even after clearing cache and cookies.",
      },
    ],
    dev: [
      {
        icon: "database",
        label: "Database connection refused: 127.0.0.1:5432",
        prompt:
          "My local development server cannot connect to PostgreSQL on port 5432, throwing ECONNREFUSED.",
      },
      {
        icon: "server",
        label: "Port 3000 / 8080 already in use (EADDRINUSE)",
        prompt:
          "Running npm run dev fails with 'Error: listen EADDRINUSE: address already in use :::3000'.",
      },
      {
        icon: "git-branch",
        label: "Git push rejected (non-fast-forward)",
        prompt:
          "Git push origin main is rejected with 'error: failed to push some refs ... Updates were rejected because the remote contains work'.",
      },
      {
        icon: "terminal",
        label: "Docker daemon not running (docker.sock)",
        prompt:
          "Docker CLI returns 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'",
      },
    ],
  };

  /**
   * Helper to render inline speech recognition errors or permission notices.
   */
  function renderVoiceStatusBanner(composer) {
    if (!composer) return;
    var existingStatus = composer.parentNode.querySelector(".cluezy-voice-status-msg");
    if (appState.speechErrorMessage) {
      if (!existingStatus) {
        existingStatus = document.createElement("div");
        existingStatus.className = "cluezy-voice-status-msg";
        composer.parentNode.insertBefore(existingStatus, composer);
      }
      existingStatus.textContent = appState.speechErrorMessage;
    } else if (existingStatus) {
      existingStatus.parentNode.removeChild(existingStatus);
    }
  }

  /**
   * Populate all TTS Voice selection dropdowns (.cluezy-voice-uri-select and .cluezy-vm-voice-select)
   * with voices matching the active language, prioritizing Natural / Online / Google voices.
   */
  function populateVoiceSelectDropdowns() {
    if (!CluezyVoice.isSynthesisSupported()) return;
    var voices = CluezyVoice.getAvailableVoicesForLang(appState.voiceLang || "en-IN");
    var dropdowns = document.querySelectorAll(".cluezy-voice-uri-select, .cluezy-vm-voice-select");
    dropdowns.forEach(function (sel) {
      sel.innerHTML = "";
      var autoOpt = document.createElement("option");
      autoOpt.value = "";
      autoOpt.textContent = voices.length > 0 ? "Auto (" + voices[0].name + ")" : "Auto Voice";
      sel.appendChild(autoOpt);

      voices.forEach(function (v) {
        var opt = document.createElement("option");
        opt.value = v.voiceURI || v.name;
        opt.textContent = v.name + " (" + v.lang + ")";
        if (appState.preferredVoiceURI && (appState.preferredVoiceURI === v.voiceURI || appState.preferredVoiceURI === v.name)) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });
    });
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.onvoiceschanged = function () {
        populateVoiceSelectDropdowns();
      };
    } catch (_e) {}
  }

  /**
   * Synchronize all speaker read-aloud toggle buttons (in settings popover & toolbar) to current appState.
   */
  function syncSpeakerButtonsUI() {
    var enabled = Boolean(appState.voiceSpeakerEnabled);
    document.querySelectorAll(".cluezy-speaker-toggle-btn").forEach(function (btn) {
      btn.setAttribute("aria-checked", enabled ? "true" : "false");
      if (enabled) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
      var span = btn.querySelector(".cluezy-switch-state-text, span");
      if (span && !span.classList.contains("cluezy-switch-thumb")) {
        span.textContent = enabled ? "On" : "Off";
      }
    });
  }

  /**
   * Render primary "Voice Mode" button and Settings icon popover (Read-aloud switch, Language select, full-name Voice select) in the header.
   */
  function renderHeaderVoiceControls(actionsContainer, authSlot) {
    if (!actionsContainer) return;
    var voiceSlot = actionsContainer.querySelector(".cluezy-header-voice-slot");
    if (!voiceSlot) {
      voiceSlot = document.createElement("div");
      voiceSlot.className = "cluezy-header-voice-slot";
      actionsContainer.insertBefore(voiceSlot, authSlot || actionsContainer.firstChild);

      // 1. Primary "Voice Mode" button (Feature-detected)
      if (CluezyVoiceMode.isSupported()) {
        var vmBtn = document.createElement("button");
        vmBtn.type = "button";
        vmBtn.className = "cluezy-header-voice-btn cluezy-header-voicemode-btn";
        vmBtn.setAttribute("aria-label", "Start Hands-Free Voice Mode");
        vmBtn.setAttribute("title", "Start Hands-Free Voice Mode");
        var vmIcon = (window.lucide && window.lucide.svg)
          ? window.lucide.svg("audio-lines", { size: 16 })
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>';
        vmBtn.innerHTML = vmIcon + "<span>Voice Mode</span>";

        vmBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var openPop = document.getElementById("cluezy-settings-popover");
          if (openPop) openPop.classList.remove("open");
          CluezyVoiceMode.openOverlay();
        });
        voiceSlot.appendChild(vmBtn);
      }

      // 2. Settings Icon Button + Popover
      if (CluezyVoice.isSynthesisSupported() || CluezyVoice.isRecognitionSupported()) {
        var settingsWrap = document.createElement("div");
        settingsWrap.className = "cluezy-settings-popover-wrap";

        var settingsBtn = document.createElement("button");
        settingsBtn.type = "button";
        settingsBtn.id = "cluezy-settings-btn";
        settingsBtn.className = "cluezy-header-voice-btn cluezy-settings-trigger-btn";
        settingsBtn.setAttribute("aria-label", "Voice and audio settings");
        settingsBtn.setAttribute("aria-haspopup", "dialog");
        settingsBtn.setAttribute("aria-expanded", "false");
        settingsBtn.setAttribute("aria-controls", "cluezy-settings-popover");
        settingsBtn.setAttribute("title", "Voice & Read-Aloud Settings");
        settingsBtn.innerHTML = (window.lucide && window.lucide.svg)
          ? window.lucide.svg("settings", { size: 16 })
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

        var popover = document.createElement("div");
        popover.id = "cluezy-settings-popover";
        popover.className = "cluezy-settings-popover";
        popover.setAttribute("role", "dialog");
        popover.setAttribute("aria-label", "Voice and audio settings");

        // Row 1: Read-aloud toggle switch
        if (CluezyVoice.isSynthesisSupported()) {
          var switchRow = document.createElement("div");
          switchRow.className = "cluezy-settings-row cluezy-settings-row-inline";
          var switchLabel = document.createElement("span");
          switchLabel.className = "cluezy-settings-label";
          switchLabel.textContent = "Read aloud responses";

          var headerSpeakerBtn = document.createElement("button");
          headerSpeakerBtn.type = "button";
          headerSpeakerBtn.setAttribute("role", "switch");
          headerSpeakerBtn.setAttribute("aria-checked", appState.voiceSpeakerEnabled ? "true" : "false");
          headerSpeakerBtn.setAttribute("aria-label", "Toggle read-aloud");
          headerSpeakerBtn.className =
            "cluezy-header-voice-btn cluezy-speaker-toggle-btn cluezy-switch-btn" +
            (appState.voiceSpeakerEnabled ? " active" : "");
          headerSpeakerBtn.innerHTML =
            '<span class="cluezy-switch-track"><span class="cluezy-switch-thumb"></span></span>' +
            '<span class="cluezy-switch-state-text">' + (appState.voiceSpeakerEnabled ? "On" : "Off") + "</span>";

          headerSpeakerBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var nextState = !appState.voiceSpeakerEnabled;
            CluezyVoice.setSpeakerEnabled(nextState);
            syncSpeakerButtonsUI();
            if (nextState) {
              triggerAssistantMessageSpeech(true);
            }
          });

          switchRow.appendChild(switchLabel);
          switchRow.appendChild(headerSpeakerBtn);
          popover.appendChild(switchRow);
        }

        // Row 2: Language Select
        var langRow = document.createElement("div");
        langRow.className = "cluezy-settings-row";
        var langLabel = document.createElement("label");
        langLabel.className = "cluezy-settings-label";
        langLabel.textContent = "Language";

        var headerLangSelect = document.createElement("select");
        headerLangSelect.className = "cluezy-voice-lang-select";
        headerLangSelect.setAttribute("aria-label", "Voice language");

        var optEn = document.createElement("option");
        optEn.value = "en-IN";
        optEn.textContent = "English (en-IN)";
        if (appState.voiceLang === "en-IN") optEn.selected = true;

        var optHi = document.createElement("option");
        optHi.value = "hi-IN";
        optHi.textContent = "हिंदी (hi-IN)";
        if (appState.voiceLang === "hi-IN") optHi.selected = true;

        headerLangSelect.appendChild(optEn);
        headerLangSelect.appendChild(optHi);

        headerLangSelect.addEventListener("change", function (e) {
          e.stopPropagation();
          CluezyVoice.setLanguage(headerLangSelect.value);
          document.querySelectorAll(".cluezy-voice-lang-select, .cluezy-vm-lang-select").forEach(function (sel) {
            sel.value = headerLangSelect.value;
          });
          populateVoiceSelectDropdowns();
        });

        langRow.appendChild(langLabel);
        langRow.appendChild(headerLangSelect);
        popover.appendChild(langRow);

        // Row 3: Voice Select (full names, no truncation, min-width)
        if (CluezyVoice.isSynthesisSupported()) {
          var voiceRow = document.createElement("div");
          voiceRow.className = "cluezy-settings-row";
          var voiceLabel = document.createElement("label");
          voiceLabel.className = "cluezy-settings-label";
          voiceLabel.textContent = "Voice";

          var voiceUriSelect = document.createElement("select");
          voiceUriSelect.className = "cluezy-voice-uri-select";
          voiceUriSelect.setAttribute("aria-label", "Select preferred speech voice");
          voiceUriSelect.addEventListener("change", function (e) {
            e.stopPropagation();
            CluezyVoice.setPreferredVoiceURI(voiceUriSelect.value);
            document.querySelectorAll(".cluezy-voice-uri-select, .cluezy-vm-voice-select").forEach(function (s) {
              s.value = voiceUriSelect.value;
            });
          });

          voiceRow.appendChild(voiceLabel);
          voiceRow.appendChild(voiceUriSelect);
          popover.appendChild(voiceRow);
        }

        settingsBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var acctMenu = document.getElementById("cluezy-account-dropdown");
          if (acctMenu && acctMenu.parentNode) acctMenu.parentNode.removeChild(acctMenu);
          var isOpen = popover.classList.toggle("open");
          settingsBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
          if (isOpen) {
            populateVoiceSelectDropdowns();
          }
        });

        popover.addEventListener("click", function (e) {
          e.stopPropagation();
        });

        if (!window._cluezySettingsOutsideBound) {
          window._cluezySettingsOutsideBound = true;
          document.addEventListener("click", function (e) {
            var pop = document.getElementById("cluezy-settings-popover");
            var btn = document.getElementById("cluezy-settings-btn");
            if (pop && pop.classList.contains("open")) {
              if (!pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
                pop.classList.remove("open");
                if (btn) btn.setAttribute("aria-expanded", "false");
              }
            }
          });
        }

        settingsWrap.appendChild(settingsBtn);
        settingsWrap.appendChild(popover);
        voiceSlot.appendChild(settingsWrap);
        populateVoiceSelectDropdowns();
      }
    } else {
      syncSpeakerButtonsUI();
      var sel = voiceSlot.querySelector(".cluezy-voice-lang-select");
      if (sel) sel.value = appState.voiceLang || "en-IN";
      populateVoiceSelectDropdowns();
    }
  }

  /**
   * Render the Voice toolbar (Speaker read-aloud toggle, Language selector, and Voice Mode button).
   */
  function renderVoiceToolbar(convContainer) {
    if (!convContainer || (!CluezyVoice.isSynthesisSupported() && !CluezyVoice.isRecognitionSupported())) return;
    var existingBar = convContainer.querySelector(".cluezy-voice-controls-bar");
    if (!existingBar) {
      existingBar = document.createElement("div");
      existingBar.className = "cluezy-voice-controls-bar";

      var leftGroup = document.createElement("div");
      leftGroup.className = "cluezy-voice-actions-group";

      // Speaker read-aloud toggle
      if (CluezyVoice.isSynthesisSupported()) {
        var speakerBtn = document.createElement("button");
        speakerBtn.type = "button";
        speakerBtn.className =
          "cluezy-voice-btn cluezy-speaker-toggle-btn" + (appState.voiceSpeakerEnabled ? " active" : "");
        speakerBtn.setAttribute("aria-label", "Toggle voice read-aloud");
        speakerBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>' +
          '<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>' +
          '</svg>' +
          '<span>Voice Read-Aloud: ' + (appState.voiceSpeakerEnabled ? "On" : "Off") + '</span>';

        speakerBtn.addEventListener("click", function (e) {
          e.preventDefault();
          var nextState = !appState.voiceSpeakerEnabled;
          CluezyVoice.setSpeakerEnabled(nextState);
          syncSpeakerButtonsUI();
          if (nextState) {
            triggerAssistantMessageSpeech(true);
          }
        });
        leftGroup.appendChild(speakerBtn);
      }

      // Hands-Free Voice Mode launcher button
      if (CluezyVoiceMode.isSupported()) {
        var vmLaunchBtn = document.createElement("button");
        vmLaunchBtn.type = "button";
        vmLaunchBtn.className = "cluezy-voice-btn cluezy-header-voicemode-btn";
        vmLaunchBtn.setAttribute("aria-label", "Start Hands-Free Voice Mode");
        vmLaunchBtn.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 2v20M17 5v14M7 5v14M22 9v6M2 9v6"></path>' +
          '</svg>' +
          '<span>Voice Mode</span>';
        vmLaunchBtn.addEventListener("click", function (e) {
          e.preventDefault();
          CluezyVoiceMode.openOverlay();
        });
        leftGroup.appendChild(vmLaunchBtn);
      }

      // Language selector
      var langGroup = document.createElement("div");
      langGroup.className = "cluezy-voice-actions-group";
      langGroup.innerHTML = '<span style="font-size:12px;color:#58655e;font-weight:500;">Language:</span>';

      var langSelect = document.createElement("select");
      langSelect.className = "cluezy-voice-lang-select";
      langSelect.setAttribute("aria-label", "Select voice language");

      var optEn = document.createElement("option");
      optEn.value = "en-IN";
      optEn.textContent = "English (India)";
      if (appState.voiceLang === "en-IN") optEn.selected = true;

      var optHi = document.createElement("option");
      optHi.value = "hi-IN";
      optHi.textContent = "हिंदी (Hindi)";
      if (appState.voiceLang === "hi-IN") optHi.selected = true;

      langSelect.appendChild(optEn);
      langSelect.appendChild(optHi);

      langSelect.addEventListener("change", function () {
        CluezyVoice.setLanguage(langSelect.value);
        document.querySelectorAll(".cluezy-voice-lang-select, .cluezy-vm-lang-select").forEach(function (sel) {
          sel.value = langSelect.value;
        });
        populateVoiceSelectDropdowns();
      });

      langGroup.appendChild(langSelect);

      // Voice dropdown in settings bar remembered in localStorage
      if (CluezyVoice.isSynthesisSupported()) {
        var voiceUriSelect = document.createElement("select");
        voiceUriSelect.className = "cluezy-voice-uri-select";
        voiceUriSelect.setAttribute("aria-label", "Select preferred speech voice");
        voiceUriSelect.setAttribute("title", "Select TTS Voice (prefers Natural / Online / Google)");
        voiceUriSelect.addEventListener("change", function () {
          CluezyVoice.setPreferredVoiceURI(voiceUriSelect.value);
          document.querySelectorAll(".cluezy-voice-uri-select, .cluezy-vm-voice-select").forEach(function (s) {
            s.value = voiceUriSelect.value;
          });
        });
        langGroup.appendChild(voiceUriSelect);
      }

      existingBar.appendChild(leftGroup);
      existingBar.appendChild(langGroup);
      populateVoiceSelectDropdowns();
    } else {
      syncSpeakerButtonsUI();
      var barSel = existingBar.querySelector(".cluezy-voice-lang-select");
      if (barSel) barSel.value = appState.voiceLang || "en-IN";
      populateVoiceSelectDropdowns();
    }
    return existingBar;
  }

  /**
   * Automatically speak the latest assistant message using ONLY `presentation.spoken` (never full message) if speaker is ON.
   * Does not speak inside chat mode if Hands-Free Voice Mode overlay is currently active (Voice Mode handles its own speech).
   */
  function triggerAssistantMessageSpeech(force) {
    if (CluezyVoiceMode.getIsOpen() && !force) return;
    if (!appState.voiceSpeakerEnabled && !force) return;
    var inv = appState.currentInvestigation;
    if (!inv || !Array.isArray(inv.messages) || inv.messages.length === 0) return;

    var lastAssistantMsg = null;
    for (var i = inv.messages.length - 1; i >= 0; i--) {
      if (inv.messages[i].sender === "assistant") {
        lastAssistantMsg = inv.messages[i];
        break;
      }
    }
    if (!lastAssistantMsg) return;

    var msgId = lastAssistantMsg.id || lastAssistantMsg.content;
    if (appState.lastSpokenMessageId === msgId && !force) return;
    appState.lastSpokenMessageId = msgId;

    var spokenText = CluezyVoice.buildSpokenTextForMessage(lastAssistantMsg);
    CluezyVoice.speakText(spokenText, null, Boolean(force));
  }
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

      // 1. Update Heading & Status Indicator (small status dot + text shown only when loading)
      var headingH2 = root.querySelector('[data-framer-name="Investigation heading"] h2');
      var statusBadgeEl = root.querySelector('[data-framer-name="Status Active"]');
      var statusSpan = root.querySelector(
        '[data-framer-name="Status Active"] span, [data-framer-name="Status Active"] p'
      );

      if (inv) {
        if (headingH2) {
          headingH2.textContent = "Investigation #" + inv.reference_id;
        }
      } else {
        if (headingH2) {
          headingH2.textContent = "New Investigation";
        }
      }

      if (statusBadgeEl) {
        statusBadgeEl.classList.add("cluezy-loading-status-indicator");
        if (appState.isSubmitting) {
          statusBadgeEl.style.display = "inline-flex";
          if (statusSpan) {
            statusSpan.textContent = "Working…";
          }
        } else {
          statusBadgeEl.style.display = "none";
        }
      }

      // Header controls: Voice Mode button, Settings popover, and Avatar menu
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
          paperclip.setAttribute("role", "button");
          paperclip.setAttribute("tabindex", "0");
          paperclip.setAttribute("aria-label", "Attach log, error screenshot, or system info");
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
          paperclip.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInp.click();
            }
          });
        }

        // Voice Input Mic Button next to input (Feature-detected)
        var existingMicBtn = composer.querySelector(".cluezy-mic-btn");
        if (!existingMicBtn && CluezyVoice.isRecognitionSupported()) {
          var micBtn = document.createElement("button");
          micBtn.type = "button";
          micBtn.className = "cluezy-voice-btn cluezy-mic-btn";
          micBtn.setAttribute("aria-label", "Voice input");
          micBtn.setAttribute("title", "Voice Input (Speech to text)");
          micBtn.innerHTML = (window.lucide && window.lucide.svg)
            ? window.lucide.svg("mic", { size: 18 })
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>' +
              '<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>' +
              '<line x1="12" y1="19" x2="12" y2="23"></line>' +
              '<line x1="8" y1="23" x2="16" y2="23"></line>' +
              '</svg>';

          micBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var currentTa = replyBox ? replyBox.querySelector("textarea.cluezy-chat-textarea") : textarea;
            CluezyVoice.toggleRecording(currentTa, function () {
              if (appState.isRecording) {
                micBtn.classList.add("recording");
                micBtn.setAttribute("title", "Recording… Tap to finish speaking");
              } else {
                micBtn.classList.remove("recording");
                micBtn.setAttribute("title", "Voice Input (Speech to text)");
              }
              renderVoiceStatusBanner(composer);
            });
          });

          // Insert right before send button
          if (sendBtn && sendBtn.parentNode) {
            sendBtn.parentNode.insertBefore(micBtn, sendBtn);
          } else {
            composer.appendChild(micBtn);
          }
        } else if (existingMicBtn) {
          if (appState.isRecording) {
            existingMicBtn.classList.add("recording");
            existingMicBtn.setAttribute("title", "Recording… Tap to finish speaking");
          } else {
            existingMicBtn.classList.remove("recording");
            existingMicBtn.setAttribute("title", "Voice Input (Speech to text)");
          }
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
        sendBtn.setAttribute("aria-label", "Send message");
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
          // Centered Middle Layout for New Investigation (Phase 3 Empty State)
          convContainer.classList.add("cluezy-new-investigation-layout");

          // 1. Hero welcome section (Heading + one-line plain description, no pill)
          var heroSection = document.createElement("div");
          heroSection.className = "cluezy-hero-welcome-section";
          heroSection.innerHTML =
            '<h1 class="cluezy-hero-title">Describe your technical problem</h1>' +
            '<p class="cluezy-hero-subtitle">Type your issue below or choose a common problem to start troubleshooting.</p>';
          convContainer.appendChild(heroSection);

          // 2. Prominent centered input box with attach and mic icons
          if (composer) {
            convContainer.appendChild(composer);
            renderVoiceStatusBanner(composer);
          }

          // 3. Category Tabs (underline tabs with Lucide icons, no emoji)
          var categoriesContainer = document.createElement("div");
          categoriesContainer.className = "cluezy-starter-categories";
          categoriesContainer.setAttribute("role", "tablist");
          categoriesContainer.setAttribute("aria-label", "Problem categories");
          var currentCategory = appState.selectedStarterCategory || "all";
          STARTER_CATEGORIES.forEach(function (cat) {
            var pill = document.createElement("button");
            pill.type = "button";
            pill.setAttribute("role", "tab");
            pill.setAttribute("aria-selected", cat.id === currentCategory ? "true" : "false");
            pill.className = "cluezy-category-pill" + (cat.id === currentCategory ? " active" : "");
            var catIconHtml = (window.lucide && window.lucide.svg)
              ? window.lucide.svg(cat.icon || "sparkles", { size: 15, className: "cluezy-category-tab-icon" })
              : "";
            pill.innerHTML = catIconHtml + "<span>" + escapeHtml(cat.label) + "</span>";
            pill.addEventListener("click", function () {
              appState.selectedStarterCategory = cat.id;
              renderInvestigationView();
            });
            categoriesContainer.appendChild(pill);
          });
          convContainer.appendChild(categoriesContainer);

          // 4. Suggested problems: 2-column grid of cards (1 column on mobile) with one icon each and short label
          answersContainer.innerHTML = "";
          var prompts = STARTER_PROMPTS_BY_CATEGORY[currentCategory] || STARTER_PROMPTS_BY_CATEGORY["all"];
          prompts.forEach(function (sp) {
            var card = document.createElement("a");
            card.href = "javascript:void(0)";
            card.setAttribute("role", "button");
            card.setAttribute("tabindex", "0");
            card.className = "cluezy-starter-card";
            var cardIconHtml = (window.lucide && window.lucide.svg)
              ? window.lucide.svg(sp.icon || "help-circle", { size: 18, className: "cluezy-starter-card-icon" })
              : "";
            card.innerHTML =
              '<span class="cluezy-starter-card-icon-wrap">' + cardIconHtml + "</span>" +
              '<span class="cluezy-starter-card-label">' + escapeHtml(sp.label) + "</span>";
            bindActionClick(card, function (e) {
              if (e) e.preventDefault();
              startNewInvestigation(sp.prompt);
            });
            card.addEventListener("keydown", function (e) {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                startNewInvestigation(sp.prompt);
              }
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
            var bubble = createChatBubbleDOM(msg.sender, msg.content || msg.text || "", formatTime(msg.created_at), msg);
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

          // Pin composer at bottom (voice settings live in header popover)
          if (composer) {
            convContainer.appendChild(composer);
            renderVoiceStatusBanner(composer);
          }

          // Auto-scroll conversation to bottom
          convContainer.scrollTop = convContainer.scrollHeight;

          // Trigger assistant speech read-aloud if speaker is enabled
          triggerAssistantMessageSpeech(false);
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

      // Ensure mobile bottom-sheet header exists inside the Investigation Context sidebar
      var sheetHeader = sidebar.querySelector(".cluezy-context-sheet-header");
      if (!sheetHeader) {
        sheetHeader = document.createElement("div");
        sheetHeader.className = "cluezy-context-sheet-header";
        sheetHeader.innerHTML =
          '<div class="cluezy-context-sheet-title">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
            '<span>Diagnostic Clues &amp; Causes</span>' +
          '</div>' +
          '<button type="button" class="cluezy-context-sheet-close" aria-label="Close diagnostic context">Done ✕</button>';
        var closeSheetBtn = sheetHeader.querySelector(".cluezy-context-sheet-close");
        if (closeSheetBtn) {
          closeSheetBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.remove("cluezy-mobile-context-open");
          });
        }
        sidebar.insertBefore(sheetHeader, sidebar.firstChild);
      }

      // Remove existing dynamic or static items between headers
      var toRemove = [];
      var children = Array.from(sidebar.children);
      var keepSet = new Set([
        sheetHeader,
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
      var causes = inv && Array.isArray(inv.candidate_causes) ? inv.candidate_causes.slice() : [];
      var hasContextData = evidenceItems.length > 0 || causes.length > 0;

      // Hide right "Investigation Context" panel on desktop until investigation has evidence or causes
      if (!hasContextData) {
        sidebar.classList.add("cluezy-context-empty-hidden");
      } else {
        sidebar.classList.remove("cluezy-context-empty-hidden");
      }

      if (evidenceItems.length === 0) {
        var emptyEv = document.createElement("div");
        emptyEv.className = "cluezy-context-real-empty";
        emptyEv.textContent = "Evidence and likely causes will appear here as you answer";
        sidebar.insertBefore(emptyEv, possibleCausesHeader);
      } else {
        evidenceItems.forEach(function (ev) {
          var row = createEvidenceRowDOM(ev);
          sidebar.insertBefore(row, possibleCausesHeader);
        });
      }

      // B. Populate "Possible causes" Items before nextStepHeader
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
        var emptyCause = document.createElement("div");
        emptyCause.className = "cluezy-context-real-empty";
        emptyCause.textContent = "Evidence and likely causes will appear here as you answer";
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
            document.body.classList.remove("cluezy-mobile-context-open");
            navigateTo("/solution/", { id: inv.reference_id });
          });
        }
      }
    });

    updateMobileContextBadges(inv);
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
    // Cancel any active speech or recording immediately when user sends a message
    CluezyVoice.stopSpeaking();
    CluezyVoice.stopRecording();

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
    CluezyVoice.stopSpeaking();
    CluezyVoice.stopRecording();
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
          var stepElements = [];
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
            stepElements.push(stepDiv);
          });

          // Runbook Voice Guidance Controller (Step-by-step reading with "Next step" and "Repeat" buttons)
          if (stepsList.length > 0 && CluezyVoice.isSynthesisSupported()) {
            var voiceBox = document.createElement("div");
            voiceBox.className = "cluezy-solution-voice-box";

            var currentIdx = appState.solutionActiveStepIndex || 0;
            if (currentIdx >= stepsList.length) currentIdx = 0;
            appState.solutionActiveStepIndex = currentIdx;

            // Highlight current step visually
            stepElements.forEach(function (el, i) {
              if (i === currentIdx) {
                el.classList.add("cluezy-step-active-highlight");
              } else {
                el.classList.remove("cluezy-step-active-highlight");
              }
            });

            var voiceHeader = document.createElement("div");
            voiceHeader.className = "cluezy-solution-voice-header";
            voiceHeader.innerHTML =
              '<span>Step ' + (currentIdx + 1) + ' of ' + stepsList.length + ' · Audio Guidance</span>' +
              '<span style="font-size:12px;font-weight:normal;color:#145c38;">' + (appState.voiceLang === 'hi-IN' ? 'हिंदी' : 'English') + '</span>';

            var voiceActions = document.createElement("div");
            voiceActions.className = "cluezy-solution-voice-actions";

            function speakCurrentRunbookStep() {
              var sIdx = appState.solutionActiveStepIndex || 0;
              var stepText = stepsList[sIdx] || "";
              var prefix =
                appState.voiceLang === "hi-IN"
                  ? "चरण " + (sIdx + 1) + ": "
                  : "Step " + (sIdx + 1) + ": ";
              CluezyVoice.speakText(prefix + stepText, null, true);
            }

            // Speak Current / Repeat button
            var repeatBtn = document.createElement("button");
            repeatBtn.type = "button";
            repeatBtn.className = "cluezy-step-voice-btn";
            repeatBtn.innerHTML =
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
              '<polyline points="1 4 1 10 7 10"></polyline>' +
              '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>' +
              '</svg>' +
              '<span>Repeat step ' + (currentIdx + 1) + '</span>';
            repeatBtn.addEventListener("click", function (e) {
              e.preventDefault();
              speakCurrentRunbookStep();
            });

            // Next step button
            var nextStepBtn = document.createElement("button");
            nextStepBtn.type = "button";
            nextStepBtn.className = "cluezy-step-voice-btn";
            nextStepBtn.innerHTML =
              '<span>Next step</span>' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
              '<polyline points="9 18 15 12 9 6"></polyline>' +
              '</svg>';
            nextStepBtn.addEventListener("click", function (e) {
              e.preventDefault();
              var nextIdx = (appState.solutionActiveStepIndex || 0) + 1;
              if (nextIdx >= stepsList.length) nextIdx = 0;
              appState.solutionActiveStepIndex = nextIdx;
              renderSolutionView();
              speakCurrentRunbookStep();
            });

            // Language switch pill in solution view
            var langBtn = document.createElement("button");
            langBtn.type = "button";
            langBtn.className = "cluezy-step-voice-btn";
            langBtn.innerHTML = '<span>🌐 ' + (appState.voiceLang === "hi-IN" ? "Switch to English" : "Switch to Hindi") + '</span>';
            langBtn.addEventListener("click", function (e) {
              e.preventDefault();
              var newLang = appState.voiceLang === "hi-IN" ? "en-IN" : "hi-IN";
              CluezyVoice.setLanguage(newLang);
              renderSolutionView();
              speakCurrentRunbookStep();
            });

            voiceActions.appendChild(repeatBtn);
            if (stepsList.length > 1) {
              voiceActions.appendChild(nextStepBtn);
            }
            voiceActions.appendChild(langBtn);

            voiceBox.appendChild(voiceHeader);
            voiceBox.appendChild(voiceActions);
            stepsBox.appendChild(voiceBox);
          }

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
    CluezyVoice.stopSpeaking();
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
              // Pre-populate lastSpokenMessageId with existing history so read-aloud only speaks NEW assistant messages
              if (inv && Array.isArray(inv.messages)) {
                for (var mIdx = inv.messages.length - 1; mIdx >= 0; mIdx--) {
                  if (inv.messages[mIdx].sender === "assistant") {
                    appState.lastSpokenMessageId = inv.messages[mIdx].id || inv.messages[mIdx].content;
                    break;
                  }
                }
              }
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
   * Close all mobile slide-out drawers (Sidebar & Context Sheet).
   */
  function closeAllMobileDrawers() {
    if (document.body) {
      document.body.classList.remove("cluezy-mobile-sidebar-open");
      document.body.classList.remove("cluezy-mobile-context-open");
    }
  }

  /**
   * Update the live clue/cause count badges on mobile context toggle buttons.
   */
  function updateMobileContextBadges(inv) {
    var evCount = inv && Array.isArray(inv.evidence) ? inv.evidence.length : 0;
    var causeCount =
      inv && Array.isArray(inv.candidate_causes)
        ? inv.candidate_causes.filter(function (c) {
            return c.status !== "ruled_out";
          }).length
        : 0;
    var totalCount = evCount + causeCount;

    var badges = document.querySelectorAll(".cluezy-mobile-context-badge");
    badges.forEach(function (b) {
      b.textContent = String(totalCount);
      b.style.display = totalCount > 0 ? "inline-block" : "none";
    });
  }

  /**
   * Inject and bind the responsive Mobile Top Bar, Backdrop Overlay, Sidebar Close Button,
   * and Inline Context Sheet Toggle Button for mobile and tablet screens (<= 1024px).
   */
  function ensureMobileNavigationUI() {
    var hasWorkspaceSidebar = !!document.querySelector('[data-framer-name="Sidebar"]');
    if (!hasWorkspaceSidebar) return;

    // 1. Backdrop overlay
    var backdrop = document.querySelector(".cluezy-mobile-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "cluezy-mobile-backdrop";
      backdrop.addEventListener("click", function (e) {
        e.preventDefault();
        closeAllMobileDrawers();
      });
      document.body.appendChild(backdrop);
    }

    // 2. Close button inside Sidebar drawer
    var sidebars = document.querySelectorAll('[data-framer-name="Sidebar"]');
    sidebars.forEach(function (sb) {
      if (!sb.querySelector(".cluezy-sidebar-close-btn")) {
        var closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "cluezy-sidebar-close-btn";
        closeBtn.setAttribute("aria-label", "Close sidebar menu");
        closeBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        closeBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          document.body.classList.remove("cluezy-mobile-sidebar-open");
        });
        sb.appendChild(closeBtn);
      }
    });

    // 3. Mobile Top Navigation Bar
    var isInvestigationPage = !!document.querySelector('[data-framer-name="investigation content"]');
    var topbar = document.querySelector(".cluezy-mobile-topbar");
    if (!topbar) {
      topbar = document.createElement("header");
      topbar.className = "cluezy-mobile-topbar";
      topbar.innerHTML =
        '<div class="cluezy-mobile-topbar-left">' +
          '<button type="button" class="cluezy-mobile-menu-btn" aria-label="Open navigation menu" title="Menu">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>' +
          '</button>' +
          '<a class="cluezy-mobile-brand" href="/" title="CLUEZY Home">' +
            '<img src="/images/logo.png" alt="CLUEZY" style="height:24px;width:auto;object-fit:contain;" />' +
            '<img src="/images/text.png" alt="CLUEZY" style="height:15px;width:auto;object-fit:contain;" />' +
          '</a>' +
        '</div>' +
        '<div class="cluezy-mobile-topbar-right">' +
          '<button type="button" class="cluezy-mobile-context-btn" title="View Diagnostic Clues &amp; Causes">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
            '<span>Clues</span>' +
            '<span class="cluezy-mobile-context-badge" style="display:none;">0</span>' +
          '</button>' +
          '<button type="button" class="cluezy-mobile-new-btn" title="Start New Investigation">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
            '<span>New</span>' +
          '</button>' +
        '</div>';

      var menuBtn = topbar.querySelector(".cluezy-mobile-menu-btn");
      if (menuBtn) {
        menuBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          document.body.classList.remove("cluezy-mobile-context-open");
          document.body.classList.toggle("cluezy-mobile-sidebar-open");
        });
      }

      var brandLink = topbar.querySelector(".cluezy-mobile-brand");
      if (brandLink) {
        bindActionClick(brandLink, function () {
          closeAllMobileDrawers();
          navigateTo("/");
        });
      }

      var ctxBtn = topbar.querySelector(".cluezy-mobile-context-btn");
      if (ctxBtn) {
        ctxBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          document.body.classList.remove("cluezy-mobile-sidebar-open");
          document.body.classList.toggle("cluezy-mobile-context-open");
        });
      }

      var newBtn = topbar.querySelector(".cluezy-mobile-new-btn");
      if (newBtn) {
        bindActionClick(newBtn, function () {
          closeAllMobileDrawers();
          API.setCurrentInvestigationId(null);
          appState.currentInvestigation = null;
          navigateTo("/investigation/", { new: "1" });
        });
      }

      document.body.appendChild(topbar);
    }

    var topCtxBtn = topbar.querySelector(".cluezy-mobile-context-btn");
    if (topCtxBtn) {
      topCtxBtn.style.display = isInvestigationPage ? "inline-flex" : "none";
    }

    // 4. Inline "Clues & Causes" toggle button inside Investigation Heading
    var invHeading = document.querySelector('[data-framer-name="Investigation heading"]');
    if (invHeading) {
      var actionsContainer = invHeading.querySelector(".cluezy-heading-actions") || invHeading;
      if (!invHeading.querySelector(".cluezy-inline-context-btn")) {
        var inlineCtxBtn = document.createElement("button");
        inlineCtxBtn.type = "button";
        inlineCtxBtn.className = "cluezy-inline-context-btn";
        inlineCtxBtn.title = "View What We Know & Possible Causes";
        inlineCtxBtn.innerHTML =
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
          '<span>Clues &amp; Causes</span>' +
          '<span class="cluezy-mobile-context-badge" style="display:none;">0</span>';
        inlineCtxBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          document.body.classList.remove("cluezy-mobile-sidebar-open");
          document.body.classList.toggle("cluezy-mobile-context-open");
        });
        actionsContainer.insertBefore(inlineCtxBtn, actionsContainer.firstChild);
      }
    }

    updateMobileContextBadges(appState.currentInvestigation);

    // Escape key closes mobile drawers
    if (!window._cluezyEscDrawerBound) {
      window._cluezyEscDrawerBound = true;
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          closeAllMobileDrawers();
        }
      });
    }
  }

  /**
   * Make Knowledge Base search input and topic category pills interactive across all devices.
   */
  function renderKnowledgeBaseView() {
    var root = document.querySelector('[data-framer-name="knowledge content"]');
    if (!root) return;

    appState.isUpdatingDOM = true;
    try {
      root.setAttribute("data-cluezy-rendered", "true");
      var searchBox = root.querySelector('[data-framer-name="Search topics"]');
      var textWrap = searchBox
        ? searchBox.querySelector('[data-framer-name*="Search topics"]') || searchBox.querySelector(".framer-1mas3tm")
        : null;

      if (textWrap && !textWrap.querySelector("input.cluezy-search-input")) {
        textWrap.innerHTML = "";
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "cluezy-search-input";
        inp.placeholder = "Search topics, e.g., “DNS”, “Slow laptop”, “Python”…";
        inp.value = appState.kbSearchQuery || "";
        inp.addEventListener("input", function () {
          appState.kbSearchQuery = inp.value;
          filterKnowledgeGuides(root);
        });
        textWrap.appendChild(inp);
      }

      var topicCats = root.querySelector('[data-framer-name="Topic categories"]');
      if (topicCats && !topicCats.dataset.bound) {
        topicCats.dataset.bound = "true";
        var pills = Array.from(topicCats.children);
        pills.forEach(function (pill) {
          pill.style.cursor = "pointer";
          pill.addEventListener("click", function () {
            var labelEl = pill.querySelector("span, p");
            var catText = labelEl ? labelEl.textContent.trim().toLowerCase() : "all";
            appState.kbCategory = catText;
            pills.forEach(function (p) {
              var pTextEl = p.querySelector("span, p");
              var isSelected = p === pill;
              p.style.backgroundColor = isSelected ? "var(--token-aW35IeuAs, #145c38)" : "var(--token-gMr3EOQJF, #f5f6f3)";
              if (pTextEl) {
                pTextEl.style.color = isSelected ? "#ffffff" : "var(--token-vfjxZCpBY, #17251f)";
                pTextEl.style.setProperty("--framer-text-color", isSelected ? "#ffffff" : "var(--token-vfjxZCpBY, #17251f)");
              }
            });
            filterKnowledgeGuides(root);
          });
        });
      }
    } finally {
      appState.isUpdatingDOM = false;
    }
  }

  function filterKnowledgeGuides(root) {
    var guidesBox = root.querySelector('[data-framer-name="Troubleshooting guides"]');
    if (!guidesBox) return;
    var q = (appState.kbSearchQuery || "").trim().toLowerCase();
    var cat = (appState.kbCategory || "all").toLowerCase();

    Array.from(guidesBox.children).forEach(function (card) {
      var text = (card.textContent || "").toLowerCase();
      var matchesQuery = !q || text.indexOf(q) >= 0;
      var matchesCat = true;
      if (cat && cat !== "all") {
        if (cat === "network") matchesCat = text.indexOf("wi-fi") >= 0 || text.indexOf("internet") >= 0 || text.indexOf("dns") >= 0;
        else if (cat === "os") matchesCat = text.indexOf("laptop") >= 0 || text.indexOf("windows") >= 0 || text.indexOf("performance") >= 0;
        else if (cat === "programming") matchesCat = text.indexOf("python") >= 0 || text.indexOf("code") >= 0 || text.indexOf("error") >= 0;
        else if (cat === "software") matchesCat = text.indexOf("app") >= 0 || text.indexOf("python") >= 0 || text.indexOf("performance") >= 0;
      }
      card.style.display = matchesQuery && matchesCat ? "flex" : "none";
    });
  }

  /**
   * Detect which page component is present in the DOM and mount/render it.
   */
  function mountCurrentRouteDOM() {
    if (appState.isUpdatingDOM) return;
    ensureHelperStyles();
    bindSidebarAndSessionQuota();
    ensureMobileNavigationUI();

    var heroEl = document.querySelector('[data-framer-name="Troubleshooting hero"]');
    if (heroEl && heroEl.getAttribute("data-cluezy-rendered") !== "true") {
      mountLandingPage(heroEl);
    }

    var invEl = document.querySelector('[data-framer-name="investigation content"]');
    var solEl = document.querySelector('[data-framer-name="solution content"]');
    var resEl = document.querySelector('[data-framer-name="resolved content"]');
    var listEl = document.querySelector('[data-framer-name="investigations content"]');
    var kbEl = document.querySelector('[data-framer-name="knowledge content"]');

    if (invEl || solEl || resEl || listEl || kbEl) {
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

    if (listEl) {
      renderInvestigationsListView();
    }

    if (kbEl) {
      renderKnowledgeBaseView();
    }

    ensureMobileNavigationUI();
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
      CluezyVoiceMode.closeOverlay();
      CluezyVoice.stopRecording();
      CluezyVoice.stopSpeaking();
      dataLoadStarted = false;
      loadInitialBackendState();
    });
    window.addEventListener("pageshow", function (event) {
      if (event && event.persisted) {
        dataLoadStarted = false;
        loadInitialBackendState();
      }
    });
    window.addEventListener("pagehide", function () {
      CluezyVoiceMode.closeOverlay();
      CluezyVoice.stopRecording();
      CluezyVoice.stopSpeaking();
    });
    window.addEventListener("beforeunload", function () {
      CluezyVoiceMode.closeOverlay();
      CluezyVoice.stopRecording();
      CluezyVoice.stopSpeaking();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && CluezyVoiceMode.getIsOpen()) {
        CluezyVoiceMode.closeOverlay();
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

