# ADR 0003: Durable Atlas API before the chat gateway

Status: accepted
Date: 2026-09-06

## Decision

Implement persistent Atlas records, import jobs, and journal entries behind
HTTP routes before deploying OpenClaw/WeChat. Use D1 for the current private web
vertical slice, and keep the store behind a server adapter so it can move to a
separate service later.

## Why

The earlier UI contained inert navigation and in-memory fixtures. Connecting a
chat agent to that surface would give the appearance of automation without a
shared, durable source of truth. A typed API gives the web UI and agent the same
operations and makes behavior testable independently of the harness.

## Consequences

- Web edits and journal entries survive sessions.
- Import requests exist before the collector is online and can be retried.
- OpenClaw must call the API rather than access D1 directly.
- A separate signed API edge may be required because the Sites UI remains
  owner-private.
- Photo/video persistence needs an object store in a later migration.
