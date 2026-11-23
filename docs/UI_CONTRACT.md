# CLUEZY Frontend UI Contract (`docs/UI_CONTRACT.md`)

This document inventories every DOM element `id`, `class`, and `data-*` attribute queried, mutated, or created by `frontend/assets/js/cluezy-api.js` and `frontend/assets/js/cluezy-app.js`.

**Contract Rule:** None of these selectors, IDs, classes, or `data-*` attributes may be renamed or removed. Visual redesigns must preserve these hooks intact so all existing tests (`verify-build.js`, `test-frontend.js`) and runtime behaviors continue working without regression.

---

## 1. `frontend/assets/js/cluezy-api.js`

### Meta & Config Selectors
| Selector / Attribute | Usage |
| :--- | :--- |
| `meta[name="cluezy-api-base"]` | Queried via `document.querySelector('meta[name="cluezy-api-base"]')` to read `content` attribute for API base URL override. |

---

## 2. `frontend/assets/js/cluezy-app.js`

### A. Element IDs (`#id`)
| ID | Usage |
| :--- | :--- |
| `#main` | Root Framer mount container observed by `MutationObserver` (`document.getElementById("main")`). |
| `#cluezy-helper-styles` | Injected `<style>` tag (`document.getElementById("cluezy-helper-styles")`). |
| `#cluezy-voice-mode-overlay` | Fullscreen Hands-Free Voice Mode dialog overlay (`document.getElementById("cluezy-voice-mode-overlay")`). |
| `#cluezy-vm-tap-zone` | Center content & tap area inside Voice Mode overlay. |
| `#cluezy-vm-state-badge` | State pill badge (`IDLE` / `Listening…` / `Thinking…` / `Speaking…`) in Voice Mode overlay. |
| `#cluezy-vm-orb-wrap` | Animated orb wrapper inside Voice Mode overlay (`#cluezy-vm-orb-wrap`). |
| `#cluezy-vm-turn-card` | Structured turn presentation card inside Voice Mode overlay. |
| `#cluezy-vm-turn-summary` | One-line summary element inside Voice Mode turn card. |
| `#cluezy-vm-turn-checklist` | Numbered tickable checklist container inside Voice Mode turn card. |
| `#cluezy-vm-turn-question` | Primary diagnostic question text inside Voice Mode turn card. |
| `#cluezy-vm-options-pills` | Quick-reply option chips container inside Voice Mode turn card. |
| `#cluezy-vm-yousaid-row` | Compact user transcript row inside Voice Mode overlay. |
| `#cluezy-vm-transcript-box` | Live/final user transcript text span inside Voice Mode overlay. |
| `#cluezy-vm-inline-edit-btn` | Inline pencil edit button next to "You said" transcript in Voice Mode overlay. |
| `#cluezy-vm-edit-btn` | Footer "Cancel / Edit in Chat" button in Voice Mode overlay. |
| `#cluezy-vm-hint` | Footer voice command hint text in Voice Mode overlay. |
| `#cluezy-account-dropdown` | Account/profile popover dropdown (`document.getElementById("cluezy-account-dropdown")`). |
| `#cluezy-logout-btn` | Sign-out button inside `#cluezy-account-dropdown`. |
| `#cluezy-header-auth-container` | Landing page header auth container (`document.getElementById("cluezy-header-auth-container")`). |
| `#cluezy-header-account-dropdown` | Landing page header account dropdown (`document.getElementById("cluezy-header-account-dropdown")`). |
| `#cluezy-header-profile-btn` | Landing page header profile pill button. |
| `#cluezy-header-logout-btn` | Sign-out button inside `#cluezy-header-account-dropdown`. |
| `#cluezy-header-google-btn` | Landing page "Sign in with Google" button. |
| `#cluezy-composer-file-input` | Hidden `<input type="file">` for log/screenshot attachment in the chat composer. |
| `#cluezy-settings-popover` | Voice & Read-Aloud settings popover in the page header. |
| `#cluezy-settings-btn` | Header settings icon button that toggles `#cluezy-settings-popover`. |

---

### B. `data-*` Attributes
| Attribute | Usage |
| :--- | :--- |
| `[data-layout-template="true"]` | Outer workspace flex layout wrapper across app pages. |
| `[data-framer-root]` | Root Framer page container element. |
| `[data-framer-component-type="RichTextContainer"]` | Framer rich text container wrapper. |
| `[data-styles-preset="HNZA9_QSM"]` | Body text preset attribute on `<p>` tags. |
| `[data-styles-preset="LwAm2Brje"]` | Small/meta text preset attribute on `<p>` tags. |
| `[data-styles-preset="Z1BYkLRW1"]` | Label/button text preset attribute on `<p>` tags. |
| `[data-border="true"]` | Framer bordered card marker. |
| `[data-cluezy-rendered="true"]` | Marker set on page root sections once `cluezy-app.js` has rendered them. |
| `[data-allow-while-busy]` | Optional attribute allowing click actions while `appState.isSubmitting` is true. |
| `[data-vm-state]` | Set on `#cluezy-voice-mode-overlay` (`idle`, `listening`, `thinking`, `speaking`). |
| `dataset.bound` | Set on elements (`paperclip.dataset.bound`, `topicCats.dataset.bound`) to prevent duplicate event binding. |
| `[data-framer-name="Sidebar"]` | Left workspace navigation sidebar. |
| `[data-framer-name="Cluezy brand"]` | Sidebar brand logo link. |
| `[data-framer-name="CLUEZY logo"]` | Brand logo element. |
| `[data-framer-name="CLUEZY"]` | Brand text container inside sidebar logo link. |
| `[data-framer-name="Workspace navigation"]` | `<nav>` container inside the sidebar. |
| `[data-framer-name="New Investigation"]` | Sidebar link & history page button to start a new investigation. |
| `[data-framer-name="My Investigations"]` | Sidebar link to `/investigations/`. |
| `[data-framer-name="Knowledge Base"]` | Deprecated sidebar link (hidden/removed). |
| `[data-framer-name="Saved Fixes"]` | Deprecated sidebar link (hidden/removed). |
| `[data-framer-name="Sidebar space"]` | Spacer element in sidebar. |
| `[data-framer-name="Free plan usage"]` | Token usage widget container in sidebar. |
| `[data-framer-name="Remaining allowance"]` | Progress fill bar inside token usage widget. |
| `[data-framer-name="Profile"]` | User profile / avatar container at bottom of sidebar. |
| `[data-framer-name="Logout"]` | Sidebar logout link attribute. |
| `[data-framer-name="investigation content"]` | Root container for `/investigation/index.html`. |
| `[data-framer-name="Investigation heading"]` | Top header bar inside investigation page. |
| `[data-framer-name="Status Active"]` | Status indicator pill inside investigation header. |
| `[data-framer-name="Conversation and context"]` | Two-column main body flex wrapper on investigation page. |
| `[data-framer-name="Conversation"]` | Left chat stream and empty-state container on investigation page. |
| `[data-framer-name="Your issue"]` | User message bubble container. |
| `[data-framer-name="Cluezy response"]` | Assistant message bubble container. |
| `[data-framer-name="Diagnostic answers"]` | Quick-reply chips / starter cards container. |
| `[data-framer-name="Default"]` | Quick-reply button anchor element. |
| `[data-framer-name="Label"]` | Text wrapper inside quick-reply button. |
| `[data-framer-name="Reply composer"]` | Chat input bar container. |
| `[data-framer-name="Paperclip"]` | Attachment icon inside reply composer. |
| `[data-framer-name="Type your reply..."]` | Textarea mount container inside reply composer. |
| `[data-framer-name="Send reply"]`, `[data-framer-name="Send"]`, `a[data-framer-name*="Send"]` | Send message button inside reply composer. |
| `[data-framer-name="Investigation context"]`, `[data-framer-name="Investigation Context"]` | Right-hand context panel on investigation page. |
| `[data-framer-name="What we know"]` | Evidence section heading in context panel. |
| `[data-framer-name="Possible causes"]` | Candidate causes section heading in context panel. |
| `[data-framer-name="Next step"]` | Next step section heading in context panel. |
| `[data-framer-name="Next check"]` | Action link inside Next step section of context panel. |
| `[data-framer-name="solution content"]` | Root container for `/solution/index.html`. |
| `[data-framer-name="Step 2 of 3 · Testing a solution"]` | Subheading container on solution walkthrough page. |
| `[data-framer-name="DNS diagnosis"]` | Main diagnosis card on solution walkthrough page. |
| `[data-framer-name="Change DNS steps"]` | Runbook steps container inside diagnosis card. |
| `[data-framer-name="Fix result choices"]` | Outcome buttons container on solution walkthrough page. |
| `[data-framer-name="resolved content"]` | Root container for `/resolved/index.html`. |
| `[data-framer-name="Problem Resolved!"]` | Heading container on resolved page. |
| `[data-framer-name="Your issue was fixed by updating the DNS"]` | Subtitle container on resolved page. |
| `[data-framer-name="What was the issue?"]` | Root cause section on resolved page. |
| `[data-framer-name="What fixed it?"]` | Fix applied section on resolved page. |
| `[data-framer-name="Save this Fix"]` | Primary action button container on resolved page. |
| `[data-framer-name="View Full Report"]` | Secondary action button container on resolved page. |
| `[data-framer-name="Start a new investigation"]` | Link to start a new investigation on resolved page. |
| `[data-framer-name="investigations content"]` | Root container for `/investigations/index.html`. |
| `[data-framer-name="Search investigations..."]` | Search input mount container on investigations list page. |
| `[data-framer-name="Status All Status"]` | Filter tabs mount container on investigations list page. |
| `[data-framer-name="Investigation list"]` | Cards list container on investigations list page. |
| `[data-framer-name="Investigation details"]` | Text column inside an investigation history card. |
| `[data-framer-name="Status Resolved"]`, `[data-framer-name="Status In Progress"]` | Status badge on an investigation history card. |
| `[data-framer-name="knowledge content"]` | Root container for `/knowledge-base/index.html`. |
| `[data-framer-name="Search topics"]`, `[data-framer-name*="Search topics"]` | Search box on knowledge base page. |
| `[data-framer-name="Topic categories"]` | Category filter pills on knowledge base page. |
| `[data-framer-name="Troubleshooting guides"]` | Guides list container on knowledge base page. |
| `[data-framer-name="Troubleshooting hero"]` | Landing page hero container (do not touch landing page). |
| `[data-framer-name="Laptop prompt"]`, `[data-framer-name="My laptop is very slow..."]` | Landing page hero interactive input (do not touch landing page). |
| `[data-framer-name="Start Troubleshooting"]`, `[data-framer-name="Get Started"]`, `[data-framer-name="See How It Works"]`, `[data-framer-name="Features"]`, `[data-framer-name="Account actions"]`, `[data-framer-name="Sign In"]` | Landing page selectors (do not touch landing page). |

---

### C. CSS Classes Queried or Assigned by JS

#### 1. Framer Structural Classes Referenced in JS
- `.framer-sbem9`, `.framer-n22pd4`, `.framer-r5haeu`, `.framer-u8w30`, `.framer-we2i1d`, `.framer-ff8y6p`, `.framer-6i2sda`, `.hidden-1wt4h8m` (Sidebar & layout template)
- `.framer-xyKMK`, `.framer-ypbln3`, `.framer-nbz4r4`, `.framer-1yyitid`, `.framer-1voc2cp`, `.framer-1f6swql`, `.framer-1qpwm9z`, `.framer-sz1ut5` (Investigation page layout)
- `.framer-vu1os6`, `.framer-nzm9lm`, `.framer-vl9599` (User message bubble)
- `.framer-wvffk8`, `.framer-ekz3f`, `.framer-11kt4mn`, `.framer-1t5lc6m` (Assistant message bubble)
- `.framer-e0rgel`, `.framer-1v8wo4k-container`, `.framer-zqgly1-container`, `.framer-6VCSX`, `.framer-ntMaH`, `.framer-9jeig7`, `.framer-v-9jeig7`, `.framer-tkxn9d`, `.framer-182kob9` (Quick-reply chips)
- `.framer-1sacewz`, `.framer-1wzs70`, `.framer-lTDXg`, `.framer-a6u4ss`, `.framer-AxTtK`, `.framer-19trnlj`, `.framer-PQmMh`, `.framer-16v1pv9`, `.framer-gFLMO`, `.framer-1ell5i7` (Context panel evidence items)
- `.framer-15lhbe8`, `.framer-1dc4w9q`, `.framer-9syjr7`, `.framer-ku9eke`, `.framer-1brbmjb`, `.framer-yk78ty`, `.framer-1u3sefx`, `.framer-2hyt8x`, `.framer-1i0e59f`, `.framer-vaquvj` (Context panel candidate causes)
- `.framer-BxVAd`, `.framer-1g3woon`, `.framer-1w8ad4e`, `.framer-146hex6`, `.framer-1cye3qs`, `.framer-1qydjjz`, `.framer-p2z1ts`, `.framer-o7e1v`, `.framer-5iotyh`, `.framer-b97f9y`, `.framer-1iqpv4o`, `.framer-xjpebi` (Solution page)
- `.framer-fnZmG`, `.framer-1remmab`, `.framer-1uqe61t`, `.framer-1rpe3e4`, `.framer-v42pep`, `.framer-1w276xg`, `.framer-u4ka4c`, `.framer-1gl26h2` (Resolved page)
- `.framer-EQe3b`, `.framer-3ap5fj`, `.framer-18etrkb`, `.framer-1nkaxif`, `.framer-1xep79e`, `.framer-94geo0`, `.framer-15h09tb`, `.framer-twck85`, `.framer-40pjob`, `.framer-nlyvx1`, `.framer-tr9q8b`, `.framer-tp9wga`, `.framer-1ag8mch`, `.framer-11jjf5q`, `.framer-1y1wa10`, `.hidden-dyjihb`, `.framer-1kge8pt` (Investigations list page)
- `.framer-QebP1`, `.framer-6z3yif`, `.framer-1mas3tm` (Knowledge base page)
- `.framer-text`, `.framer-styles-preset-g5gvkz`, `.framer-styles-preset-150qgy0`, `.framer-styles-preset-1hewirz` (Typography presets)

#### 2. Application Controller (`cluezy-*`) Classes
- **Page & Layout State**: `.cluezy-no-page-scroll`, `.cluezy-disabled`, `.cluezy-clickable`, `.cluezy-mobile-sidebar-open`, `.cluezy-mobile-context-open`
- **Inputs & Composer**: `.cluezy-chat-textarea`, `.cluezy-input-bar-enhanced`, `.cluezy-search-input`, `.cluezy-hero-input`, `.cluezy-mic-btn`, `.recording`
- **Voice & Settings Controls**: `.cluezy-voice-controls-bar`, `.cluezy-voice-actions-group`, `.cluezy-voice-btn`, `.cluezy-speaker-toggle-btn`, `.cluezy-voice-lang-select`, `.cluezy-voice-uri-select`, `.cluezy-voice-status-msg`, `.cluezy-header-voice-slot`, `.cluezy-header-voice-btn`, `.cluezy-header-voicemode-btn`
- **Voice Mode Overlay**: `.cluezy-vm-overlay`, `.open`, `.cluezy-vm-topbar`, `.cluezy-vm-brand`, `.cluezy-vm-dot`, `.cluezy-vm-top-actions`, `.cluezy-vm-lang-select`, `.cluezy-vm-voice-select`, `.cluezy-vm-close-btn`, `.cluezy-vm-center`, `.cluezy-vm-state-badge`, `.cluezy-vm-orb-wrap`, `.cluezy-vm-orb`, `.cluezy-vm-orb-ring`, `.cluezy-vm-orb-ring-1`, `.cluezy-vm-orb-ring-2`, `.cluezy-vm-waveform`, `.cluezy-vm-turn-card`, `.cluezy-vm-turn-summary`, `.cluezy-vm-turn-checklist`, `.cluezy-vm-turn-question`, `.cluezy-vm-options-pills`, `.cluezy-vm-opt-pill`, `.cluezy-vm-yousaid-row`, `.cluezy-vm-yousaid-text`, `.error`, `.cluezy-vm-yousaid-edit`, `.cluezy-vm-footer`, `.cluezy-vm-action-btn`, `.cluezy-vm-hint`
- **Structured Turn Cards & Checklists**: `.cluezy-chat-turn-card`, `.cluezy-chat-turn-summary`, `.cluezy-chat-turn-checklist`, `.cluezy-chat-turn-question`, `.cluezy-turn-check-item`, `.checked`, `.cluezy-turn-check-label`, `.cluezy-turn-check-cb`, `.cluezy-turn-check-text`, `.cluezy-turn-check-title`, `.cluezy-turn-check-detail`, `.cluezy-turn-cmd-bar`, `.cluezy-turn-cmd-code`, `.cluezy-turn-cmd-copy`
- **Empty State & Starters**: `.cluezy-new-investigation-layout`, `.cluezy-hero-welcome-section`, `.cluezy-hero-badge`, `.cluezy-hero-title`, `.cluezy-hero-subtitle`, `.cluezy-starter-categories`, `.cluezy-category-pill`, `.active`, `.cluezy-starter-card`, `.cluezy-starter-card-label`, `.cluezy-starter-card-arrow`
- **Header & Auth**: `.cluezy-heading-actions`, `.cluezy-header-auth-slot`, `.cluezy-header-auth-pill`, `.cluezy-header-avatar`, `.cluezy-header-avatar-initial`, `.cluezy-header-user-name`, `.cluezy-header-logout-btn`, `.cluezy-header-signin-btn`, `.cluezy-google-btn`, `.cluezy-google-icon`, `.cluezy-google-btn-text`, `.cluezy-header-profile-pill`, `.cluezy-header-name`
- **Sidebar & Profile**: `.cluezy-sidebar-brand-img`, `.cluezy-sidebar-recent`, `.cluezy-recent-header`, `.cluezy-recent-chevron`, `.cluezy-recent-list`, `.cluezy-recent-item`, `.cluezy-dot`, `.cluezy-title`, `.cluezy-time`, `.cluezy-profile-card-inner`, `.cluezy-sidebar-logout-btn`, `.cluezy-nav-logout-btn`, `.cluezy-sidebar-signin-btn`
- **Context & Solution Helpers**: `.cluezy-cause-note`, `.cluezy-banner-error`, `.cluezy-banner-info`, `.cluezy-typing-indicator`, `.cluezy-quick-reply-btn`, `.cluezy-solution-voice-box`, `.cluezy-solution-voice-header`, `.cluezy-solution-voice-actions`, `.cluezy-step-voice-btn`, `.cluezy-step-active-highlight`, `.cluezy-category-tabs`, `.cluezy-category-tab`
- **Mobile Navigation & Drawers**: `.cluezy-mobile-topbar`, `.cluezy-mobile-topbar-left`, `.cluezy-mobile-menu-btn`, `.cluezy-mobile-brand`, `.cluezy-mobile-topbar-right`, `.cluezy-mobile-context-btn`, `.cluezy-mobile-context-badge`, `.cluezy-mobile-new-btn`, `.cluezy-mobile-backdrop`, `.cluezy-sidebar-close-btn`, `.cluezy-context-sheet-header`, `.cluezy-context-sheet-title`, `.cluezy-context-sheet-close`, `.cluezy-inline-context-btn`
