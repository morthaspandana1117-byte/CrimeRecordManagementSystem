# Crime Record Management System

## Description

A web application for managing criminal records, FIRs, police officers, evidence and reports.

## Team Members

Member 1

Member 2

Member 3

## Technology Stack

Frontend
- React.js
- Tailwind CSS

Backend
- Node.js
- Express.js

Database
- MongoDB Atlas

Authentication
- JWT

## Audit log integrity

Audit records are append-only through the application and are integrity-chained
with SHA-256 sequence metadata when MongoDB transactions are available. Active
system administrators can verify the protected chain with `GET
/api/audit/integrity`.

Verification accounts for every audit record: `legacyRecords` identifies
records without integrity metadata and `malformedRecords` identifies partially
populated integrity metadata, which fails verification. The chain and its sequence counter are stored in the same
database, so database administrators or other privileged writers can rewrite
both and bypass detection. Database-level permissions or an external immutable
audit sink are still required for tamper resistance against privileged
database access. The unique `integrity.sequence` index must be verified in
each existing deployment; resolve duplicate or conflicting data before relying
on that database constraint.

The generic audit middleware is used by legacy CRUD routes whose controllers do
not share a transaction with the middleware. If their audit write fails after
the business response is committed, the response is preserved and the
`X-Audit-Logging-Failed: true` header identifies the operational failure; it
does not claim that the business mutation was rolled back. Evidence upload and
custody workflows, officer registration, and password reset state changes use
their existing transaction boundaries where MongoDB supports transactions.
Password-reset email delivery remains external to MongoDB, so a committed and
audited reset token may still require an email-delivery retry.

Project Management
- Jira

Version Control
- GitHub

## Development Methodology

Agile Scrum
