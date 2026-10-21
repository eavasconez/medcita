# 🏥 MedCita - Application Flow & Architecture

This document explains how the MedCita application works, its user roles, and the core booking workflow.

## 👥 User Roles

| Role | Permissions |
| :--- | :--- |
| **Admin** | Manages clinics, adds/deletes doctors, full access to all schedules. |
| **Doctor** | Manages own schedule, sees own patient list, manages their availability. |
| **Secretary** | Manages agendas for one or more doctors, registers patients, handles incoming requests. |
| **Patient** | The end-user who receives notifications via WhatsApp/Email. |

## 🔄 Core Booking Workflow

The following diagram illustrates the interaction between the system and the user when scheduling an appointment.

```mermaid
graph TD
    A[User Logged In] --> B{Action}
    B -->|Calendar Slot| C[Click empty slot in Grid]
    B -->|New Button| D[Click 'New Appointment']
    
    C --> E[Modal Opens: Auto-filled Date/Time]
    D --> E[Modal Opens: Search/Create Patient]
    
    E --> F[Select Patient & Check availability]
    F --> G[Confirm Last Details]
    
    G --> H[API: POST /api/appointments]
    H --> I[Prisma DB: Save Record]
    H --> J[Notification Service]
    
    J --> K[ WhatsApp: approved Meta template (Twilio or mock if Meta is not configured) ]
    J --> L[ Email via Brevo (SendGrid as fallback) ]
    
    I --> M[Dashboard Refresh: Green/Blue Block]
```

## ⚙️ Technical Components

1.  **Frontend (React + Vite):** Uses `react-big-calendar` for the grid and `Tailwind CSS` for the premium UI.
2.  **Backend (Express + Node.js):** REST API with JWT authentication.
3.  **Database (PostgreSQL + Prisma):** Stores relationships between Doctors, Patients, and Appointments.
4.  **Notifications:**
    *   **WhatsApp:** Meta Cloud API with two approved templates (confirmation and 24h reminder), so the patient receives them without having written first. Provider order: Meta, then Twilio (plain text, sandbox), then a console mock. Only one provider is used; there is no automatic fallback if Meta errors. See `docs/DEPLOY.md`, section 7.0.
    *   **Email:** Brevo (SendGrid as fallback) sends the confirmation and reminder when the patient has an email.
5.  **Security and traceability:** login rate limiting, password recovery by email, change password in Settings (older sessions stop working), and an append-only audit log of what admins and secretaries do (`GET /api/admin/audit-log`).
6.  **Health:** `GET /api/health` answers 200, or 503 when the database is unreachable or behind the code.

## 🕒 Availability Engine

The system uses a "Block & Slot" logic:
- Doctors define **Working Hours** (e.g., Mon-Fri 08:00 - 18:00).
- The engine calculates **Slots** as long as the chosen **Appointment type** (the clinic's default is 30 minutes; admins add others such as "First visit, 40 min" in Settings). A slot is offered every `duration` minutes inside each block, plus one right where each booked visit ends.
- A day the doctor (or the whole clinic) is **blocked** — vacation, congress, holiday, set in Availability → *Time off* — has no slots and takes no bookings; what was already booked there stays and is listed to be rescheduled.
- A visit must fit inside a working block and may not overlap another one (back to back is fine); each appointment keeps the length its type had when it was booked.
- If a slot is occupied in the DB, the UI marks it as **Occupied (Orange)**.
- If it's a past time, the UI **Blocks** it for safety.
- Moving an appointment (`PUT /api/appointments/:id`) applies the same rules as booking: it answers 409 if the new slot is taken.

## 🔔 Reminders

A cron job runs every hour and reminds, once (`reminderSentAt`), the `pending_approval`, `scheduled` and `confirmed` appointments that start within the next 24 hours, using each clinic's own timezone (`Clinic.timezone`, default `America/Guayaquil`, UTC-5; an admin changes it in Settings).

---
*Created by Antigravity for the MedCita project.*
