# ADR-0001: Build a modular monolith on Next.js and Supabase

- **Status:** accepted
- **Date:** 2026-09-19

## Context
MaxOff is an internal tool for one agency and is built by one person using Claude Code. It must be simple to run and cheap (free tiers), and it must be easy to add features to for years without breaking existing ones.

## Decision
- One Next.js (App Router, TypeScript strict) app with one Supabase Postgres database.
- Code is split into **modules** (`src/modules/*`) on top of a shared **core** (`src/core/*`). Imports go `app → modules → core`, and modules use each other only through their `index.ts`. eslint-plugin-boundaries enforces this.
- Each module owns its tables. Operations that span several tables and must all succeed together are Postgres functions.

## Consequences
- It's deployed as one app, so there's no microservice overhead.
- Changing one module can't reach into another module's internals, and lint catches any violation.
- A module could later be pulled out into its own service if it ever needed to be.
- Some boilerplate (index.ts, repositories) is needed for every module.
