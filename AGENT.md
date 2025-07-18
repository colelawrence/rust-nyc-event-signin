# Agent Configuration for Event Check-In System

## Commands
- **No explicit test/lint commands** - Val Town platform handles these automatically
- **Development**: Val Town auto-deploys on changes, no local build needed
- **Database**: SQLite migrations run automatically on startup in backend/index.ts

## Architecture
- **Val Town Project**: Deno-based event check-in system with React frontend
- **Backend**: Hono API server (backend/index.ts) handling event management and check-ins
- **Frontend**: React 18.2.0 with TypeScript (frontend/index.tsx, components/)
- **Database**: SQLite with events_4, attendees_4, checkins_4, and sessions_2 tables
- **Features**: Password-protected event creation, CSV attendee upload, fuzzy search, analytics
- **Shared**: TypeScript types and utilities (shared/types.ts)

## Core Functionality
- **Event Management**: Create events with attendee lists via CSV upload
- **Check-In Process**: Attendees find their name using fuzzy search and check in with one click
- **Analytics**: Track check-in rates, date-based charts, export data as CSV
- **Security**: Password protection for event management, multiple check-in tracking

## Code Style (from .cursorrules)
- **Language**: TypeScript/TSX with React 18.2.0
- **Imports**: Use `https://esm.sh` for npm packages, pin React to 18.2.0
- **Types**: Add TypeScript types for all data structures
- **Secrets**: Always use environment variables, never hardcode secrets
- **JSX**: Start React files with `/** @jsxImportSource https://esm.sh/react@18.2.0 */`
- **Styling**: Default to TailwindCSS via CDN script tag
- **Error Handling**: Let errors bubble up with context, avoid empty catch blocks
- **Database**: Change table names (e.g., _3, _4) when modifying schemas instead of ALTER TABLE
- **Platform**: Use Val Town utils for file operations (readFile, serveFile)
- **SQLite**: ALWAYS handle query results properly - use `result.rows || result` pattern to access data
  - WRONG: `const result = await sqlite.execute(query); result[0].column`
  - CORRECT: `const rawResult = await sqlite.execute(query); const result = rawResult.rows || rawResult; result[0].column`
