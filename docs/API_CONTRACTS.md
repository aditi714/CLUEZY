# CLUEZY API Contracts & Specifications

## Overview

The CLUEZY backend exposes a RESTful JSON API engineered with FastAPI and Pydantic. It provides anonymous session management, rate-limiting, and diagnostic investigation workflows for technical problem-solving.

- **Base URL (Local)**: `http://localhost:8000`
- **API Version 1 Prefix**: `/api/v1`
- **Interactive Documentation**: `http://localhost:8000/docs` (Swagger UI) / `http://localhost:8000/redoc` (ReDoc)

---

## Authentication & Session Management

CLUEZY provides seamless dual-authentication: frictionless anonymous access for new users, and permanent Google OAuth sign-in powered by Supabase Auth.

### 1. Authenticated Google Sessions (Supabase Auth)
- **Header Name**: `Authorization`
- **Format**: `Bearer <supabase_access_token>`
- **Signing Algorithm**: Asymmetric ECDSA `ES256` validated against Supabase JWKS (`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`)
- **Features**: Permanent cloud persistence across devices, user profile derivation (name, Google avatar), multi-tenant isolation, and anonymous history claiming.

### 2. Anonymous Sessions
- **Header Name**: `X-Session-Token`
- **Format**: `clz_<32-byte-urlsafe-token>`
- **Token Allowance**: 200,000 tokens/day per session
- **Default TTL**: 720 hours (30 days)

Requests to protected endpoints (`/investigations/*`) accept either an `Authorization: Bearer <token>` or `X-Session-Token` header. When an anonymous user signs in via Google OAuth, their past anonymous investigations can be claimed into their permanent user account.

---

## Standard Response Schemas

### Success Response (`APIResponse[T]`)

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable confirmation"
}
```

### Error Response (`APIResponse`)

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Descriptive explanation of the error",
    "details": null
  }
}
```

### Common HTTP Status Codes

| Code | Meaning | Reason |
| :--- | :--- | :--- |
| `200 OK` | Success | Request succeeded and returned data |
| `201 Created` | Created | Resource successfully created |
| `400 Bad Request` | Client Error | Malformed parameters or incompatible payload |
| `401 Unauthorized` | Missing / Invalid Token | Missing or expired `X-Session-Token` |
| `404 Not Found` | Not Found | Resource or investigation ID does not exist |
| `422 Unprocessable` | Validation Error | Request payload failed Pydantic schema validation |
| `429 Too Many Requests`| Rate Limit Exceeded | Daily session token quota exhausted |
| `500 Server Error` | Internal Server Error | Unhandled server exception |

---

## Endpoints

### 1. Health Checks

#### `GET /health` & `GET /api/v1/health`

Checks application uptime, database connectivity, and configured AI services.

- **Auth Required**: None
- **Response**:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "environment": "development",
    "database_connected": true,
    "services": {
      "database": "connected",
      "groq_ai": "configured"
    },
    "version": "0.1.0"
  },
  "message": "Service is operational"
}
```

---

### 2. Anonymous Sessions

#### `POST /api/v1/sessions`

Initializes a new anonymous session.

- **Auth Required**: None
- **Request Body (Optional)**:

```json
{
  "user_identifier": "Parth"
}
```

- **Response (`200 OK`)**:

```json
{
  "success": true,
  "data": {
    "id": "c1f1b250-9ecb-432a-bc91-38e5d0d8ba39",
    "session_token": "clz_aB3...k9P",
    "user_identifier": "Parth",
    "daily_token_limit": 200000,
    "tokens_used": 0,
    "remaining_tokens": 200000,
    "remaining_percentage": 100.0,
    "is_active": true,
    "expires_at": "2026-12-18T19:00:00Z",
    "created_at": "2026-11-18T19:00:00Z"
  },
  "message": "Anonymous session initialized successfully."
}
```

#### `GET /api/v1/sessions/me`

Retrieves status and token balance for the current session.

- **Auth Required**: `X-Session-Token`
- **Response (`200 OK`)**:

```json
{
  "success": true,
  "data": {
    "id": "c1f1b250-9ecb-432a-bc91-38e5d0d8ba39",
    "session_token": "clz_aB3...k9P",
    "user_identifier": "Parth",
    "daily_token_limit": 200000,
    "tokens_used": 44000,
    "remaining_tokens": 156000,
    "remaining_percentage": 78.0,
    "is_active": true,
    "expires_at": "2026-12-18T19:00:00Z",
    "created_at": "2026-11-18T19:00:00Z"
  },
  "message": "Session active."
}
```

---

### 3. Investigations

#### `POST /api/v1/investigations`

Creates a new troubleshooting investigation. Automatically parses problem description, seeds starter evidence, and generates an initial diagnostic check.

- **Auth Required**: `X-Session-Token`
- **Request Body**:

```json
{
  "problem_description": "My laptop is connected to Wi-Fi but websites aren't opening, though my phone works fine on the same network.",
  "title": "Laptop can't open websites (DNS issue)",
  "device_type": "Laptop (Windows)",
  "network_info": "Connected to Wi-Fi",
  "category": "Network"
}
```

- **Response (`201 Created`)**:

```json
{
  "success": true,
  "data": {
    "id": "9d906ea1-b25a-493e-a8f8-bca74e6f3b0e",
    "reference_id": "INV-2387",
    "session_id": "c1f1b250-9ecb-432a-bc91-38e5d0d8ba39",
    "title": "Laptop can't open websites (DNS issue)",
    "problem_description": "My laptop is connected to Wi-Fi but websites aren't opening...",
    "device_type": "Laptop (Windows)",
    "os_info": null,
    "network_info": "Connected to Wi-Fi",
    "status": "active",
    "category": "Network",
    "created_at": "2026-11-18T19:05:00Z",
    "updated_at": "2026-11-18T19:05:00Z",
    "resolved_at": null,
    "messages": [
      {
        "id": "d0e1...",
        "investigation_id": "9d906ea1...",
        "sender": "user",
        "content": "My laptop is connected to Wi-Fi...",
        "suggested_responses": [],
        "created_at": "2026-11-18T19:05:00Z"
      },
      {
        "id": "e2f3...",
        "investigation_id": "9d906ea1...",
        "sender": "assistant",
        "content": "Got it. I'm investigating: \"Laptop can't open websites\". Can you check if you can open https://1.1.1.1?",
        "suggested_responses": ["It opens", "It doesn't open", "I'm not sure"],
        "created_at": "2026-11-18T19:05:01Z"
      }
    ],
    "evidence": [
      {
        "id": "f4a5...",
        "category": "device",
        "key": "Device",
        "value": "Laptop (Windows)",
        "confidence": 1.0,
        "source": "user_stated",
        "created_at": "2026-11-18T19:05:00Z"
      }
    ],
    "candidate_causes": [
      {
        "id": "a6b7...",
        "title": "DNS configuration issue",
        "likelihood": "High",
        "status": "suspected"
      },
      {
        "id": "b7c8...",
        "title": "Network settings issue",
        "likelihood": "Medium",
        "status": "suspected"
      },
      {
        "id": "c8d9...",
        "title": "Browser issue",
        "likelihood": "Low",
        "status": "suspected"
      }
    ],
    "recommended_actions": [
      {
        "id": "e9f0...",
        "title": "Check website access using IP (1.1.1.1)",
        "step_number": 1,
        "total_steps": 3,
        "steps": [
          "Open your browser",
          "Navigate directly to https://1.1.1.1",
          "Verify if Cloudflare DNS page loads"
        ],
        "expected_result": "Page loads via IP address if DNS is the sole issue.",
        "status": "pending",
        "created_at": "2026-11-18T19:05:01Z"
      }
    ],
    "report": null
  },
  "message": "Investigation INV-2387 created successfully."
}
```

#### `GET /api/v1/investigations`

Lists all past investigations created within the active user account or anonymous session.

- **Auth Required**: `Authorization: Bearer <token>` or `X-Session-Token`
- **Query Parameters**:
  - `status` (string, optional): e.g. `active`, `in_progress`, `resolved`
  - `page` (int, default `1`): Page number
  - `page_size` (int, default `20`, max `100`): Items per page
- **Response (`200 OK`)**:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "9d906ea1-b25a-493e-a8f8-bca74e6f3b0e",
        "reference_id": "INV-2387",
        "user_id": "usr_9999",
        "title": "Laptop can't open websites (DNS issue)",
        "problem_description": "My laptop is connected to Wi-Fi...",
        "status": "active",
        "category": "Network",
        "created_at": "2026-11-18T19:05:00Z",
        "updated_at": "2026-11-18T19:05:00Z",
        "resolved_at": null,
        "message_count": 2
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 20,
    "has_more": false
  }
}
```

#### `POST /api/v1/investigations/claim-anonymous`

Safely links previous anonymous investigations created under the provided anonymous session token to the authenticated Supabase user account. Idempotent and protected against claiming already-claimed sessions.

- **Auth Required**: `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "session_token": "clz_anon_token_12345"
}
```
- **Response (`200 OK`)**:
```json
{
  "success": true,
  "data": {
    "claimed_count": 2,
    "reference_ids": ["INV-1001", "INV-1002"],
    "message": "Successfully associated 2 anonymous investigation(s) with account usr_9999."
  },
  "message": "Account linking completed successfully."
}
```

#### `GET /api/v1/investigations/{identifier}`

Retrieves complete investigation details by either UUID or human-readable reference ID (e.g. `INV-2387`).

- **Auth Required**: `X-Session-Token`
- **Path Parameter**: `identifier` (UUID string or reference ID e.g. `INV-2387`)
- **Response (`200 OK`)**: Returns `APIResponse[InvestigationDetailResponse]`.

#### `POST /api/v1/investigations/{identifier}/progress`

Advances the investigation state by submitting answers to diagnostic questions or reporting action outcomes from recommended fixes. Triggers rule re-evaluation, updates candidate cause scores, and returns the next planned diagnostic check or remediation step.

- **Auth Required**: `X-Session-Token`
- **Path Parameter**: `identifier` (UUID or reference ID)
- **Request Body**:

```json
{
  "question_id": "check_ip_access",
  "selected_option_value": "ip_reachable",
  "user_message": "Yes, opening 1.1.1.1 loads Cloudflare directly.",
  "action_id": null,
  "action_outcome": null,
  "confirm_resolution": false
}
```

- **Response (`200 OK`)**: Returns updated `APIResponse[InvestigationDetailResponse]`.

#### `POST /api/v1/investigations/{identifier}/resolve`

Explicitly confirms resolution of the technical issue upon user confirmation and produces the post-mortem diagnostic report.

- **Auth Required**: `X-Session-Token`
- **Path Parameter**: `identifier` (UUID or reference ID)
- **Request Body (Optional)**:

```json
{
  "user_notes": "Confirmed issue fixed after setting DNS to 8.8.8.8."
}
```

- **Response (`200 OK`)**: Returns `APIResponse[InvestigationDetailResponse]` with `status: "resolved"` and complete `report` payload.


