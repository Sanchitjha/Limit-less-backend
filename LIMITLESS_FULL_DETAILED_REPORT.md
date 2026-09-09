# Limitless Cognitive Platform v2.0 - Complete Technical Architecture & Developer Integration Manual

**Project Name:** Limitless Cognitive Platform Backend  
**Version:** 2.0.0  
**Date:** September 8, 2026  
**Author:** Limitless Core Engineering Team  
**Audience:** Atul Sir (Executive Lead), Frontend Admin Developer, Flutter Mobile Developer  

---

## Table of Contents
1. [Executive Summary & Atul Sir's Directives Fulfillments](#1-executive-summary--atul-sirs-directives-fulfillments)
2. [File-by-File Development Breakdown](#2-file-by-file-development-breakdown)
3. [Exhaustive API Specification & Payload Reference](#3-exhaustive-api-specification--payload-reference)
4. [Frontend (Admin Panel) Developer Handoff Manual](#4-frontend-admin-panel-developer-handoff-manual)
5. [Flutter (Mobile App) Developer Handoff Manual](#5-flutter-mobile-app-developer-handoff-manual)
6. [Security, Rate Limiting & Verification Results](#6-security-rate-limiting--verification-results)

---

## 1. Executive Summary & Atul Sir's Directives Fulfillments

Today's engineering sprint focused on building a enterprise-grade administrative engine, GDPR compliance suite, real-time security monitoring, encrypted document storage, predictive analytics, and automated database backups for the **Limitless Cognitive Platform**.

### Summary of Completed Objectives
- **Admin Control Center**: Built 16+ REST APIs allowing full administration of users, payment plan levels, sub-admin approval workflows, question templates, promo coupons, customer support tickets, AI rules, system audit trails, and backup snapshot dumps.
- **GDPR Compliance Engine**: Endpoints for data portability (`POST /api/users/:id/gdpr-export`) and account erasure (`DELETE /api/users/:id/gdpr-delete`) with cascading cleanup across MongoDB GridFS and collections.
- **Security & Infrastructure Suite (Vigil & Vaultrix)**: Integrated real-time threat alert logging, session counts, system health checks (`/api/vigil`), and encrypted document storage vaults (`/api/vaultrix`).
- **Predictive Analytics & VPP Module**: Virtual Power Plant & Cognitive Capacity forecasting engine (`/api/vpp`, `predictiveAnalytics.js`).
- **Automated Database Backup**: JSON snapshot generator utility (`POST /api/admin/backup`).
- **100% Integration Test Coverage**: Automated test suite (`node test/integration.test.mjs`) passing 65 out of 65 assertion checks.

---

## 2. File-by-File Development Breakdown

### 1. `backend/src/routes/admin.routes.js`
- **Lines of Code:** 520 lines.
- **Purpose:** Primary REST router for administrative operations.
- **Key Modules Implemented:**
  - `POST /login`: Admin authentication against `config.adminUsername` & `config.adminPassword` with 15 req/5 min rate limiting.
  - `GET /stats`: Aggregated database stats calculating `total_users`, `paid_users`, `pending_users`, `demo_users`, `free_users`, `suspended_users`, `mrr` (`paid_users * $19`), `conversion_rate`, `new_users_24h`, and `pending_admin_requests`.
  - `POST /access-requests`, `GET /access-requests`, `PUT /access-requests/:id/approve`, `PUT /access-requests/:id/reject`: Sub-admin onboarding request approval workflow.
  - `GET /users`, `GET /users/:id`, `PUT /users/:id/plan`, `POST /users/:id/block`, `POST /users/:id/unblock`, `DELETE /users/:id`: Comprehensive user management with payment status overrides and cascading GridFS file deletion.
  - `GET /analytics/cognitive`, `GET /analytics/revenue`, `GET /widgets/summary`: Data feeds for charts and widgets.
  - `GET /question-bank`, `POST /question-bank`: Question Bank template CRUD.
  - `GET /coupons`, `POST /coupons`: Promo coupon creation with percentage or fixed discount support.
  - `GET /invoices`: Billing invoice ledger.
  - `GET /support-tickets`, `POST /support-tickets`, `PATCH /support-tickets/:id`: Customer support ticket management.
  - `GET /ai-rules`, `POST /ai-rules`: Dynamic AI rule threshold management.
  - `GET /activity-logs`, `GET /audit-logs`, `GET /device-logs`, `GET /system-logs`: Audit and diagnostic feeds.
  - `POST /backup`: Database backup trigger.

### 2. `backend/src/routes/users.routes.js`
- **Lines of Code:** 126 lines.
- **Purpose:** Endpoints for user profile management, assessment history, and GDPR compliance.
- **Key Modules Implemented:**
  - `GET /:id`: Retrieves user profile and their complete chronological assessment history.
  - `PATCH /:id`: Profile updates (`name`, `age`, `gender`, `email`) and backward-compatible latest assessment report updates (`report_json`, `pdf_url`).
  - `POST /:id/gdpr-export`: Compiles personal user profile and assessment history into a structured GDPR JSON package.
  - `DELETE /:id/gdpr-delete`: Implements GDPR "Right to be Forgotten" by permanently deleting user records, assessments, and stored GridFS files.

### 3. `backend/src/db/models/` (New Database Schemas)
- **`AdminAccessRequest.js`**: Schema for sub-admin access requests (`email`, `name`, `notes`, `status`: pending/approved/rejected, `reviewed_by`, `reviewed_at`).
- **`Coupon.js`**: Promo code schema (`code`, `discount_type`: percentage/fixed, `discount_value`, `max_uses`, `used_count`, `active`).
- **`ActivityLog.js`**: User activity stream (`user_id`, `action`, `ip_address`, `user_agent`, `details`).
- **`AIRule.js`**: AI engine prompt rules (`name`, `domain`, `condition_threshold`, `recommendation_template`, `risk_level`).
- **`AuditLog.js`**: Security audit trail for admin actions (`admin_id`, `action`, `target_resource`, `target_id`, `changes`).
- **`SupportTicket.js`**: Support ticket schema (`ticket_id`, `user_email`, `subject`, `message`, `priority`, `status`, `assigned_to`).
- **`Invoice.js`**: Billing ledger (`invoice_number`, `user_id`, `amount`, `currency`, `status`, `pdf_url`).
- **`QuestionBank.js`**: Assessment question templates (`category`, `title`, `question_text`, `options`).

### 4. Infrastructure & Security Files
- **`backend/src/utils/backup.js`**: JSON snapshot utility exporting database collections to timestamped files in `backend/backups/`.
- **`backend/src/vigil/vigil.routes.js`**: System health, active session tracking, and threat alert logging.
- **`backend/src/vaultrix/vaultrix.routes.js`**: Encrypted document vault routes.
- **`backend/src/vpp/forecastModel.js` & `vpp.routes.js`**: Usage forecasting models.

---

## 3. Exhaustive API Specification & Payload Reference

### Admin Authentication
#### `POST /api/admin/login`
- **Auth:** Public
- **Rate Limit:** 15 requests / 5 minutes
- **Request Body:**
  ```json
  {
    "username": "admin",
    "password": "limitlessadmin"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "role": "admin"
  }
  ```

---

### Dashboard Analytics & Stats
#### `GET /api/admin/stats`
- **Auth:** Bearer Admin Token
- **Response (200 OK):**
  ```json
  {
    "total_users": 185,
    "paid_users": 42,
    "pending_users": 12,
    "demo_users": 35,
    "free_users": 96,
    "suspended_users": 0,
    "completed_assessments": 310,
    "users_with_report": 140,
    "new_users_24h": 8,
    "pending_admin_requests": 3,
    "mrr": 798,
    "conversion_rate": 22.7
  }
  ```

#### `GET /api/admin/widgets/summary`
- **Auth:** Bearer Admin Token
- **Response (200 OK):**
  ```json
  {
    "active_sessions_now": 18,
    "daily_assessments_today": 42,
    "high_risk_alerts": 3,
    "system_health": "100% Operational"
  }
  ```

---

### User Management APIs
#### `GET /api/admin/users`
- **Auth:** Bearer Admin Token
- **Query Parameters:**
  - `search` (string): Search by name or email.
  - `role` (string): Filter by role (`user`, `admin`).
  - `payment_status` (string): Filter by payment status (`paid`, `free`, `demo`, `trial`, `suspended`).
- **Response (200 OK):** Array of user objects with attached assessment histories.

#### `PUT /api/admin/users/:id/plan`
- **Auth:** Bearer Admin Token
- **Request Body:**
  ```json
  {
    "payment_status": "paid"
  }
  ```
- **Response (200 OK):** Updated user object with `success: true`.

#### `POST /api/admin/users/:id/block`
- **Auth:** Bearer Admin Token
- **Response (200 OK):** `{ "success": true, "user": { "status": "suspended" } }`

#### `POST /api/admin/users/:id/unblock`
- **Auth:** Bearer Admin Token
- **Response (200 OK):** `{ "success": true, "user": { "status": "active" } }`

#### `DELETE /api/admin/users/:id`
- **Auth:** Bearer Admin Token
- **Response (200 OK):** `{ "success": true, "deletedAssessments": 3 }`

---

### Sub-Admin Access Requests
#### `POST /api/admin/access-requests`
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "subadmin@limitless.com",
    "name": "Alex Johnson",
    "notes": "Requesting access for customer support operations"
  }
  ```
- **Response (201 Created):** `{ "success": true, "request": { "status": "pending" } }`

#### `PUT /api/admin/access-requests/:id/approve`
- **Auth:** Bearer Admin Token
- **Response (200 OK):** `{ "success": true, "request": { "status": "approved" } }`

---

### Content & Financial Management
#### `POST /api/admin/question-bank`
- **Auth:** Bearer Admin Token
- **Request Body:**
  ```json
  {
    "category": "Memory",
    "title": "Working Memory Test",
    "question_text": "Recall the 5 sequence numbers shown previously.",
    "options": ["1-4-9-2-5", "2-4-6-8-0", "1-3-5-7-9"]
  }
  ```

#### `POST /api/admin/coupons`
- **Auth:** Bearer Admin Token
- **Request Body:**
  ```json
  {
    "code": "LIMITLESS50",
    "discount_type": "percentage",
    "discount_value": 50,
    "max_uses": 200
  }
  ```

#### `POST /api/admin/backup`
- **Auth:** Bearer Admin Token
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "timestamp": "2026-09-08T14-27-52-389Z",
    "backupPath": "c:\\Users\\Sanchit\\OneDrive\\Desktop\\Projects\\Limit less backend\\backend\\backups\\backup_2026-09-08T14-27-52-389Z.json",
    "counts": { "users": 185, "assessments": 310, "enquiries": 14 }
  }
  ```

---

### User & GDPR APIs
#### `POST /api/users/:id/gdpr-export`
- **Auth:** User (Self) or Admin
- **Response (200 OK):** JSON package containing profile and complete assessment history.

#### `DELETE /api/users/:id/gdpr-delete`
- **Auth:** User (Self) or Admin
- **Response (200 OK):** `{ "success": true, "message": "User account and associated data permanently erased per GDPR request." }`

---

## 4. Frontend (Admin Panel) Developer Handoff Manual

### Architectural Overview
The Admin Panel is a single-page web application communicating with `https://<backend-domain>/api/admin`. All administrative endpoints require a valid JWT token passed in the `Authorization` header.

### Authentication Flow
1. User submits credentials on `/admin/login`.
2. App sends `POST /api/admin/login` with `{ username, password }`.
3. Backend returns `{ token, role: "admin" }`.
4. App stores `token` in `localStorage` or HTTP-only session cookie.
5. All subsequent requests include header: `Authorization: Bearer <token>`.

### Component Implementation Mapping

```
+-----------------------------------------------------------------------------------+
| ADMIN PANEL COMPONENT DASHBOARD                                                   |
+-----------------------------------------------------------------------------------+
| 1. Top KPI Cards Widget         <--- GET /api/admin/stats                         |
| 2. Live Active Sessions Widget  <--- GET /api/admin/widgets/summary               |
| 3. Revenue Analytics Chart      <--- GET /api/admin/analytics/revenue             |
| 4. User Master Table            <--- GET /api/admin/users?search=&payment_status= |
|    - Upgrade Plan Action Button <--- PUT /api/admin/users/:id/plan                |
|    - Suspend Account Button     <--- POST /api/admin/users/:id/block              |
|    - Delete Account Button      <--- DELETE /api/admin/users/:id                  |
| 5. Sub-Admin Request Table      <--- GET /api/admin/access-requests               |
|    - Approve Request Button     <--- PUT /api/admin/access-requests/:id/approve   |
| 6. Coupon Generator Drawer      <--- POST /api/admin/coupons                      |
| 7. Question Bank Manager        <--- POST /api/admin/question-bank                |
| 8. Support Console Drawer       <--- PATCH /api/admin/support-tickets/:id         |
| 9. AI Threshold Rules Form      <--- POST /api/admin/ai-rules                     |
| 10. Database Backup Button      <--- POST /api/admin/backup                       |
+-----------------------------------------------------------------------------------+
```

---

## 5. Flutter (Mobile App) Developer Handoff Manual

### Mobile Architecture Overview
The Flutter mobile application connects to the backend REST API. Mobile users authenticate via password or social login (Google/Apple) and receive a JWT access token.

### Header Requirement
```dart
Map<String, String> get headers => {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer $userJwtToken',
};
```

### Complete Flutter Code Implementation Examples

#### 1. Fetching User Profile & Assessment Reports
```dart
Future<UserModel> fetchUserProfile(String userId, String token) async {
  final url = Uri.parse('https://api.limitless.com/api/users/$userId');
  final response = await http.get(url, headers: {
    'Authorization': 'Bearer $token',
  });

  if (response.statusCode == 200) {
    return UserModel.fromJson(jsonDecode(response.body));
  } else if (response.statusCode == 401) {
    throw Exception('Unauthorized session. Please log in again.');
  } else {
    throw Exception('Failed to load profile');
  }
}
```

#### 2. Submitting an In-App Support Ticket
```dart
Future<bool> submitSupportTicket({
  required String email,
  required String subject,
  required String message,
  required String token,
}) async {
  final url = Uri.parse('https://api.limitless.com/api/admin/support-tickets');
  final response = await http.post(
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
    body: jsonEncode({
      'user_email': email,
      'subject': subject,
      'message': message,
      'priority': 'medium',
    }),
  );

  return response.statusCode == 201;
}
```

#### 3. Requesting Account Erasure (GDPR Right to be Forgotten)
```dart
Future<bool> requestAccountDeletion(String userId, String token) async {
  final url = Uri.parse('https://api.limitless.com/api/users/$userId/gdpr-delete');
  final response = await http.delete(url, headers: {
    'Authorization': 'Bearer $token',
  });

  return response.statusCode == 200;
}
```

---

## 6. Security, Rate Limiting & Verification Results

### Protection Layer
1. **Helmet HTTP Headers**: Enforces strict transport security, XSS filters, and frameguard protection.
2. **CORS Policy**: Restricts origin domain calls with preflight caching (24 hours).
3. **Rate Limiting Rules**:
   - General API: `120 requests / 1 minute`
   - Login & Auth: `25 requests / 5 minutes`
   - Assessment Generator: `30 requests / 5 minutes`

### Integration Test Results
```bash
Command: node test/integration.test.mjs
Database: In-Memory MongoDB Server (db: limitless_test)

Results:
✔ GET /health reports database enabled
✔ POST /api/v1/generate-questions
✔ Auth & Password Lifecycle (Register, Login, Reset, Change)
✔ OAuth Integration (Google & Apple Sign-In)
✔ User Management & Profile Compatibility
✔ Stripe Payment Webhooks & Plan Activation
✔ PDF Report Stream & GridFS Storage
✔ Admin Login, Stats, Users CRUD, Plan Upgrades, Access Requests
✔ Coupons, Question Bank, Invoices, Support Tickets, AI Rules
✔ GDPR Export & GDPR Erasure
✔ Vigil Security, Vaultrix Encrypted Storage, VPP Analytics Model

SUMMARY: 65 Checks Passed | 0 Failures (100% PASS)
```
