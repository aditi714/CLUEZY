# CLUEZY — AI-Powered Technical Problem Solving Platform

CLUEZY is an intelligent conversational troubleshooting assistant that helps users diagnose and resolve complex technical problems step by step. Rather than making speculative guesses, CLUEZY systematically analyzes issues, establishes confirmed evidence, prioritizes candidate causes, guides users through targeted verification checks, and walks through verified solutions.

---

## Repository Structure

```text
CLUEZY/
├── frontend/           # Static pre-rendered application
│   ├── assets/
│   │   ├── js/
│   │   │   ├── cluezy-api.js  # Frontend API client & session manager
│   │   │   └── cluezy-app.js  # Interactive UI & DOM lifecycle controller
│   ├── fonts/          # Embedded typography
│   ├── images/         # Icons and graphics
│   ├── investigation/  # Active troubleshooting chat interface
│   ├── investigations/ # Historical investigations log
│   ├── knowledge-base/ # Knowledge base and reference guides
│   ├── solution/       # Step-by-step remediation testing flow
│   ├── resolved/       # Problem resolution summary and post-mortem
│   ├── package.json    # Frontend scripts
│   ├── serve.js        # Zero-dependency local static server
│   ├── verify-build.js # Build & asset verification check
│   ├── test-frontend.js# Automated frontend API client tests
│   └── vercel.json     # Vercel deployment configuration
├── backend/            # FastAPI application
│   ├── app/
│   │   ├── api/        # REST endpoints (health, sessions, investigations)
│   │   ├── core/       # App configuration, database engine, security, error handling
│   │   ├── models/     # 12 SQLAlchemy 2.0 ORM database models
│   │   ├── schemas/    # Pydantic v2 validation and response models
│   │   ├── services/   # Business logic services
│   │   ├── ai/         # Groq SDK client wrapper (openai/gpt-oss-120b)
│   │   └── main.py     # FastAPI application factory and lifespan manager
│   ├── alembic/        # Alembic database migrations
│   ├── tests/          # Comprehensive pytest test suite
│   ├── alembic.ini     # Alembic configuration
│   ├── requirements.txt # Production dependencies
│   ├── requirements-dev.txt # Development & test dependencies
│   ├── pyproject.toml  # Project configuration
│   ├── .env.example    # Backend environment variables template
│   └── vercel.json     # Vercel serverless Python configuration
├── docs/
│   ├── API_CONTRACTS.md # Full API specifications and request/response examples
│   └── ARCHITECTURE.md  # System architecture, ER diagram, and design documentation
├── .gitignore          # Repository git ignore rules
└── README.md           # Project documentation
```

---

## Technology Stack

### Frontend
- **Framework**: Static pre-rendered React / Next.js
- **Styling**: Tailwind CSS / Framer layout engine
- **Local Server**: Node.js HTTP server (`frontend/serve.js`) on port `5173`

### Backend
- **Framework**: Python 3.12+, FastAPI, Uvicorn
- **Validation**: Pydantic v2, Pydantic-Settings
- **ORM & Migrations**: SQLAlchemy 2.x (AsyncSession), Alembic
- **Architecture**: Modular Monolithic Architecture

### Database
- **Engine**: Supabase PostgreSQL 15+
- **Async Driver**: `asyncpg`
- **Sync Driver**: `psycopg2` (for Alembic migrations)
- **Local Fallback**: SQLite (`sqlite+aiosqlite:///./cluezy.db`) for zero-dependency local testing

### AI Integration
- **Provider**: Groq API
- **Primary Model**: `openai/gpt-oss-120b`
- **SDK**: Official Groq Python SDK (`AsyncGroq`)

### Deployment
- **Platform**: Vercel

---

## Database Models (Foundational Milestone)

1. **Anonymous Sessions (`anonymous_sessions`)**: Temporary sessions with daily token allowances (200,000 tokens/day).
2. **Investigations (`investigations`)**: Core troubleshooting cases with reference IDs (e.g. `INV-2387`).
3. **Messages (`messages`)**: Chat dialogue history between user and assistant with quick replies.
4. **Evidence (`evidence`)**: Confirmed technical facts and observations ("What we know").
5. **Candidate Causes (`candidate_causes`)**: Ranked root causes under investigation ("Possible causes").
6. **Knowledge Categories (`knowledge_categories`)**: Domain taxonomy (Network, OS, Software, Programming).
7. **Diagnostic Causes (`diagnostic_causes`)**: Catalog of known root causes.
8. **Diagnostic Questions (`diagnostic_questions`)**: Interactive questions to isolate problems.
9. **Diagnostic Rules (`diagnostic_rules`)**: Inference rules mapping evidence to cause probabilities.
10. **Recommended Actions (`recommended_actions`)**: Step-by-step diagnostic checks or remediation actions.
11. **Action Outcomes (`action_outcomes`)**: User feedback on applied actions.
12. **Reports (`reports`)**: Comprehensive resolution reports and preventative measures.

---

## Getting Started

### Prerequisites
- **Python**: 3.11 or higher
- **Node.js**: v18 or higher
- **Pip**: Latest version

---

### Backend Setup

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment (optional but recommended)**:
   ```bash
   python -m venv .venv
   # On Windows (PowerShell):
   .\.venv\Scripts\Activate.ps1
   # On Linux/macOS:
   source .venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   pip install -r requirements-dev.txt
   ```

4. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to configure your Supabase connection string and Groq API key:
   ```env
   DATABASE_URL=postgresql+asyncpg://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   DATABASE_URL_SYNC=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   GROQ_API_KEY=gsk_...
   GROQ_MODEL=openai/gpt-oss-120b
   ```
   *(Note: If no Supabase connection is specified, the application defaults gracefully to SQLite for local development).*

5. **Run database migrations**:
   ```bash
   alembic upgrade head
   ```

6. **Start the FastAPI backend server**:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

7. **Verify backend endpoints**:
   - Health check: [http://localhost:8000/health](http://localhost:8000/health)
   - Interactive API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

### Frontend Setup

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Start the local static server**:
   ```bash
   node serve.js
   ```

3. **Access the web application**:
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### Running Backend Tests

Run the complete automated test suite using `pytest`:

```bash
# From repository root:
pytest backend/tests -v

# Or from backend directory:
cd backend
pytest -v
```

---

## Documentation

- [API Contracts & Endpoints](docs/API_CONTRACTS.md): Detailed specifications of requests, responses, headers, and schemas.
- [System Architecture](docs/ARCHITECTURE.md): Architectural design, ER diagrams, Supabase pooler compatibility, and Groq SDK integration.
