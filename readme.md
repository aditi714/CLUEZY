# CLUEZY - AI-Powered Mystery Game Platform

A modern web platform for playing interactive mystery games with AI-powered evidence analysis and storytelling. Players solve cases by examining evidence, interviewing suspects, and piecing together clues with the help of advanced AI models.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Running the App](#running-the-app)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Testing](#testing)
- [AI Integration](#ai-integration)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Interactive Mystery Games**: Play engaging mystery cases with rich narratives and puzzles.
- **AI-Powered Evidence Analysis**: Upload images, audio, and documents for AI analysis and clue extraction.
- **Smart Note-Taking**: AI-powered system to organize clues, suspects, and theories.
- **Dynamic Storytelling**: AI generates responses, adapts to player actions, and provides hints.
- **User Authentication**: Secure login and profile management.
- **Case Management**: Create, edit, and manage mystery cases (admin functionality).
- **Responsive Design**: Works seamlessly on desktop and mobile devices.
- **Modern UI**: Clean and intuitive user interface with dark mode support.

---

## Tech Stack

### Frontend

- **Framework**: React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4.1
- **Routing**: React Router DOM v7
- **State Management**: TanStack Query, Zustand
- **UI Components**: Lucide React, Tailwind UI
- **Form Handling**: React Hook Form, Zod

### Backend

- **Framework**: NestJS (Node.js)
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: Passport.js (JWT)
- **Validation**: class-validator, class-transformer
- **Type Checking**: TypeGraphQL
- **Testing**: Jest

### Infrastructure

- **Database**: PostgreSQL 15+
- **AI Integration**: OpenAI API

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (LTS version, recommend 20+)
- npm or pnpm
- PostgreSQL (or Docker for containerized database)
- Git

### Installation

Follow these steps to set up the project:

1. **Clone the repository**

```bash
git clone <repository-url>
cd cluezy
```

2. **Backend Installation**

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Install database migrations
npx prisma migrate dev
```

3. **Frontend Installation**

```bash
# Navigate to frontend directory
cd ../frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

---

## Configuration

### Environment Variables

Both backend and frontend use environment variables. Create `.env` files based on the examples provided.

#### Backend `.env`

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/cluezy?schema=public"

# Auth
JWT_SECRET="your-jwt-secret"
JWT_EXPIRATION="1d"

# AI / OpenAI
OPENAI_API_KEY="your-openai-key"
OPENAI_MODEL="gpt-4o"

# File Uploads
MAX_FILE_SIZE_MB=10

# CORS
FRONTEND_URL="http://localhost:5173"

# Admin
ADMIN_EMAIL="[EMAIL_ADDRESS]"
ADMIN_PASSWORD="admin-password"
```

#### Frontend `.env`

```env
# API Base URL
VITE_API_URL="http://localhost:3000"

# Auth
VITE_JWT_SECRET="your-jwt-secret"

# OpenAI
VITE_OPENAI_API_KEY="your-openai-key"

# File Uploads
VITE_MAX_FILE_SIZE_MB=10
```

### Database Setup

We use PostgreSQL with Prisma for database management.

1. **Ensure PostgreSQL is running**

   ```bash
   # Start PostgreSQL (example for systemd)
   sudo systemctl start postgresql
   ```

2. **Create database**

   ```sql
   CREATE DATABASE cluezy;
   ```

3. **Run migrations**

   ```bash
   # Backend directory
   cd backend
   npx prisma migrate dev
   ```

4. **Generate Prisma client**

   ```bash
   npx prisma generate
   ```

---

## Running the App

### Start Backend

```bash
# In backend directory
cd backend

npm run start:dev
```

The backend will start on `http://localhost:3000`

### Start Frontend

```bash
# In frontend directory
cd frontend

npm run dev
```

The frontend will start on `http://localhost:5173`

Access the application in your browser at:
👉 **[http://localhost:5173](http://localhost:5173)**

### Available Commands

| Directory | Command | Description |
|-----------|---------|-------------|
| **Backend** | `npm run dev` | Start development server |
| | `npm run build` | Build for production |
| | `npm run start` | Start production server |
| | `npx prisma migrate dev` | Run database migrations |
| | `npx prisma generate` | Generate Prisma client |
| **Frontend** | `npm run dev` | Start development server |
| | `npm run build` | Build for production |
| | `npm run preview` | Preview production build |
| | `npm run lint` | Lint TypeScript code |

---

## Project Structure

```
cluezy/
├── backend/                    # NestJS backend
│   ├── src/
│   │   ├── auth/               # Authentication module
│   │   ├── cases/              # Case management module
│   │   ├── clues/              # Clue system
│   │   ├── evidence/           # Evidence upload and AI analysis
│   │   ├── files/              # File storage and utilities
│   │   ├── notes/              # Smart note-taking system
│   │   ├── suspects/           # Suspect management
│   │   ├── users/              # User management
│   │   ├── ai/                 # AI integration module
│   │   ├── common/             # Shared utilities
│   │   ├── config/             # Configuration
│   │   ├── guards/             # Authentication guards
│   │   ├── interceptors/       # Request interceptors
│   │   ├── filters/            # Exception filters
│   │   └── main.ts             # Application entry point
│   ├── prisma/                 # Database schemas and migrations
│   ├── test/                   # Unit and integration tests
│   └── package.json
│
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Page components
│   │   ├── services/           # API services
│   │   ├── stores/             # State management
│   │   ├── utils/              # Utility functions
│   │   ├── App.tsx             # Root component
│   │   ├── main.tsx            # Application entry point
│   │   └── index.html
│   ├── public/                 # Public assets
│   └── package.json
│
├── uploads/                    # File uploads (generated)
└── README.md                   # Project documentation
```
