<div align="center">

  <img src="assets/logo.png" alt="CLUEZY Logo" width="120" style="border-radius: 24px; margin-bottom: 12px;" />
  <br />
  <img src="assets/text.png" alt="CLUEZY Typography" width="260" style="margin-bottom: 8px;" />

  <p align="center">
    <strong>Neuro-Symbolic AI Diagnostic & Systematic Technical Troubleshooting Platform</strong>
  </p>

  <p align="center">
    <a href="#-key-features">Features</a> •
    <a href="#-architecture--neuro-symbolic-engine">Architecture</a> •
    <a href="#-system-workflow">Workflow</a> •
    <a href="#-quickstart--local-setup">Quickstart</a> •
    <a href="#-database-schema">Schema</a> •
    <a href="#-api-reference">API Docs</a> •
    <a href="#-project-credits">Credits</a>
  </p>

  <p align="center">
    <!-- Live Demo Button & Badges with Cluezy Brand Palette (#145C38 Forest Green & Mint) -->
    <a href="https://cluezy-frontend.vercel.app" target="_blank">
      <img src="https://img.shields.io/badge/Live%20Demo-cluezy--frontend.vercel.app-145C38?style=for-the-badge&logo=vercel&logoColor=white" alt="Live Demo" />
    </a>
    <img src="https://img.shields.io/badge/Python-3.12-145C38?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.12" />
    <img src="https://img.shields.io/badge/FastAPI-0.115+-145C38?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
    <img src="https://img.shields.io/badge/Groq%20AI-GPT--OSS--120B-13251E?style=for-the-badge&logo=openai&logoColor=ECF6E8" alt="Groq AI" />
    <img src="https://img.shields.io/badge/Supabase-PostgreSQL%2015-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/SQLAlchemy-2.0%20Async-D71F00?style=for-the-badge&logo=sqlalchemy&logoColor=white" alt="SQLAlchemy" />
  </p>

</div>

---

### 💡 Overview

Traditional AI assistants often generate speculative, unstructured guesses when faced with complex engineering or IT incidents. **CLUEZY** transforms troubleshooting into a rigorous, deterministic scientific method. 

By marrying a high-performance **Large Language Model (Groq / GPT-OSS 120B)** with a **Deterministic Diagnostic Rule Engine (PostgreSQL / SQLAlchemy ORM)**, CLUEZY systematically extracts verified facts, computes mathematical confidence across potential causes, prioritizes high-yield diagnostic checks, and generates verifiable remediation runbooks with rollback guarantees.

---

## 🌟 Key Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🔬 Neuro-Symbolic Triaging</h3>
      <ul>
        <li><strong>Evidence Graph:</strong> Isolates confirmed facts from user logs, error codes, and symptoms.</li>
        <li><strong>Hypothesis Ranking:</strong> Real-time probabilistic scoring across candidate root causes.</li>
        <li><strong>Zero Hallucination:</strong> Remediation steps cross-checked against strict system runbooks.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>⚡ High-Speed Execution</h3>
      <ul>
        <li><strong>Sub-Second Inference:</strong> Powered by Groq LPU acceleration for real-time investigation guidance.</li>
        <li><strong>Async I/O Engine:</strong> Non-blocking SQLAlchemy 2.0 with <code>asyncpg</code> and transaction safety.</li>
        <li><strong>Edge CDN Frontend:</strong> Pre-rendered static architecture with dynamic interactive hydration.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🛡️ Dual-Tier Security & Auth</h3>
      <ul>
        <li><strong>Supabase Auth (ES256 JWKS):</strong> Full persistence, investigation histories, and user workspaces.</li>
        <li><strong>Ephemeral Anonymous Sessions:</strong> Zero-barrier instant access with daily token rate limiting (<code>clz_...</code>).</li>
        <li><strong>Strict CORS & Headers:</strong> Built-in CSP, X-Frame-Options, and environment segregation.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>📱 Responsive Mobile First UI</h3>
      <ul>
        <li><strong>Adaptive Layouts:</strong> Dynamic <code>100dvh</code> viewport handling for mobile, tablet, and desktop.</li>
        <li><strong>Touch Context Drawer:</strong> Slide-up diagnostic drawer for evidence & causes on smaller viewports.</li>
        <li><strong>Bespoke Brand Theme:</strong> Signature Forest Green (<code>#145C38</code>) with Mint (<code>#ECF6E8</code>) dark-mode accents.</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🏛️ Architecture & Neuro-Symbolic Engine

CLUEZY's architecture guarantees that AI reasoning is constrained by deterministic domain rules, preventing dangerous remediation attempts.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CLUEZY PRESENTATION LAYER                             │
│       Desktop / Tablet / Mobile Web  •  Tailwind CSS  •  Vanilla ES6+           │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ JSON over HTTPS (Async Client)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        FASTAPI HIGH-CONCURRENCY BACKEND                         │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │ Dual Auth & Security │  │ Investigation Flow   │  │  Session Rate Limiter│   │
│  │ (ES256 JWKS + Ephem) │  │ Lifecycle Manager    │  │  (200k daily tokens) │   │
│  └──────────┬───────────┘  └──────────┬───────────┘  └──────────┬───────────┘   │
└─────────────┼─────────────────────────┼─────────────────────────┼───────────────┘
              │                         │                         │
              ▼                         ▼                         ▼
┌───────────────────────────┐ ┌───────────────────────────┐ ┌────────────────────┐
│   DETERMINISTIC ENGINE    │ │   NEURO-REASONING (AI)    │ │ PERSISTENCE LAYER  │
│  • Diagnostic Rules       │ │  • Groq API Acceleration  │ │ • Supabase Postgres│
│  • Evidence Extraction    │ │  • openai/gpt-oss-120b    │ │ • 12 Relational    │
│  • Cause Probability Math │ │  • Log & Error Parser     │ │   ORM Models       │
│  • Step Runbook Generator │ │  • Adaptive Questioner    │ │ • SQLite Fallback  │
└───────────────────────────┘ └───────────────────────────┘ └────────────────────┘
```

### Diagnostic Decision Flow

```mermaid
graph TD
    A([User Submits Issue / Logs]) --> B[Extract Raw Symptoms]
    B --> C{Deterministic Rule Match?}
    C -- High Confidence --> D[Confirm Evidence & Pin Candidate Cause]
    C -- Ambiguous --> E[Groq LPU: Generate Targeted Diagnostic Question]
    E --> F[User Verifies / Submits Check]
    F --> D
    D --> G[Calculate Bayesian Cause Probabilities]
    G --> H[Generate Step-by-Step Solution & Rollback Guard]
    H --> I[User Applies Fix & Confirms Outcome]
    I --> J([Generate Post-Mortem Report])
    
    style A fill:#145C38,stroke:#13251E,stroke-width:2px,color:#fff
    style D fill:#145C38,stroke:#13251E,stroke-width:2px,color:#fff
    style H fill:#145C38,stroke:#13251E,stroke-width:2px,color:#fff
    style J fill:#145C38,stroke:#13251E,stroke-width:2px,color:#fff
    style E fill:#ECF6E8,stroke:#145C38,stroke-width:2px,color:#13251E
    style G fill:#ECF6E8,stroke:#145C38,stroke-width:2px,color:#13251E
```

---

## 📂 Repository Layout

```text
CLUEZY/
├── frontend/               # Ultra-lightweight pre-rendered client
│   ├── assets/             # Brand logos, icons, and styling stylesheets
│   │   ├── js/
│   │   │   ├── cluezy-api.js   # Unified API client & Dual Auth token manager
│   │   │   ├── cluezy-app.js   # Mobile responsive DOM controller & lifecycle
│   │   │   └── supabase.js     # Bundled Supabase client
│   ├── investigation/      # Real-time troubleshooting terminal UI
│   ├── investigations/     # Past incidents & diagnostic history logs
│   ├── solution/           # Interactive remediation execution & checklist
│   ├── resolved/           # Incident post-mortem summary & export
│   ├── serve.js            # Zero-dependency local Node.js development server
│   └── vercel.json         # Vercel Edge CDN configuration
├── backend/                # Production FastAPI application
│   ├── app/
│   │   ├── api/            # REST API endpoints (v1 routes)
│   │   ├── core/           # Security, async database engine, config
│   │   ├── models/         # 12 SQLAlchemy 2.0 ORM database models
│   │   ├── schemas/        # Strict Pydantic v2 validation contracts
│   │   ├── services/       # Rule evaluator & diagnostic orchestrator
│   │   ├── ai/             # Groq SDK Async client (openai/gpt-oss-120b)
│   │   └── main.py         # App factory, CORS, and Lifespan handlers
│   ├── alembic/            # Database versioning & schema migrations
│   ├── tests/              # End-to-end Pytest test suite
│   ├── requirements.txt    # Production dependencies
│   └── .env.example        # Environment variable specification
├── docs/                   # Architectural blueprints & specifications
│   ├── API_CONTRACTS.md    # Request / Response schemas & endpoints
│   └── ARCHITECTURE.md     # Deep dive into engine design & ER schema
└── README.md
```

---

## 🗄️ Database Schema

The core domain model consists of **12 foundational relational models** engineered with SQLAlchemy 2.0:

<details>
<summary><strong>🔍 Click to inspect all 12 Core Entities</strong></summary>

<br />

| Model Name | Table | Description |
| :--- | :--- | :--- |
| **AnonymousSession** | `anonymous_sessions` | Ephemeral guest sessions with token quotas (200k/day). |
| **Investigation** | `investigations` | Incident lifecycle root (e.g. `INV-2024-001`) with user linking. |
| **Message** | `messages` | Chat history stream between engineer and assistant. |
| **Evidence** | `evidence` | Validated facts and observations (*"What we know"*). |
| **CandidateCause** | `candidate_causes` | Ranked root cause hypotheses under Bayesian scoring. |
| **KnowledgeCategory** | `knowledge_categories` | Hierarchical taxonomy (Network, OS, Cloud, Database). |
| **DiagnosticCause** | `diagnostic_causes` | Curated catalog of validated system failure modes. |
| **DiagnosticQuestion**| `diagnostic_questions`| Targeted questions to eliminate candidate causes. |
| **DiagnosticRule** | `diagnostic_rules` | Logical mapping connecting confirmed evidence to causes. |
| **RecommendedAction**| `recommended_actions` | Sequenced remediation runbooks with rollback commands. |
| **ActionOutcome** | `action_outcomes` | Verification telemetry recording success/failure of fixes. |
| **Report** | `reports` | Incident summaries, prevention recommendations, and RCA. |

</details>

---

## 🚀 Quickstart & Local Setup

### Prerequisites

* **Python 3.11+** (Python 3.12 recommended)
* **Node.js v18+**
* **Groq API Key** ([console.groq.com](https://console.groq.com))
* **Supabase PostgreSQL** (or built-in local SQLite fallback)

### 1. Backend Setup

```bash
# Clone the repository
git clone https://github.com/aditi714/CLUEZY.git
cd CLUEZY/backend

# Create and activate virtual environment
python -m venv .venv
# Windows:
.\.venv\Scripts\Activate.ps1
# Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# Configure environment variables
cp .env.example .env
```

Edit `.env` with your credentials:
```env
DATABASE_URL=postgresql+asyncpg://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
DATABASE_URL_SYNC=postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
GROQ_API_KEY=gsk_your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b
```
*(Leave empty to automatically fall back to local `cluezy.db` SQLite).*

```bash
# Run schema migrations
alembic upgrade head

# Start FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
* Interactive API Documentation: [http://localhost:8000/docs](http://localhost:8000/docs)
* Health Status Endpoint: [http://localhost:8000/health](http://localhost:8000/health)

### 2. Frontend Setup

In a separate terminal:
```bash
cd CLUEZY/frontend

# Launch the static HTTP server
node serve.js
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser or mobile device.

### 3. Running Automated Tests

```bash
cd CLUEZY/backend
pytest -v --disable-warnings
```

---

## 📡 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | System health check and database connectivity |
| `POST`| `/api/v1/sessions/anonymous` | Initialize guest session (generates `clz_...` token) |
| `POST`| `/api/v1/investigations/` | Start a new diagnostic investigation |
| `GET` | `/api/v1/investigations/{id}` | Retrieve investigation state, evidence, and ranked causes |
| `POST`| `/api/v1/investigations/{id}/messages` | Post message, trigger rule engine & Groq AI response |
| `POST`| `/api/v1/investigations/{id}/actions/{action_id}/outcome` | Log remediation check outcome |
| `GET` | `/api/v1/investigations/{id}/report` | Generate comprehensive RCA incident report |

For complete schemas and payload examples, refer to [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md).

---

## 👤 Project Credits

Developed as a **B.Sc. Computer Science Final Year Project** at **KBP College, Vashi** (Affiliated with **University of Mumbai**).

* **Ms. Aditi Raut** — Full-Stack Architecture, Engine Design & Development

---

<div align="center">
  <sub>Built with ❤️ by the CLUEZY Team • Empowering deterministic engineering diagnostics.</sub>
</div>
