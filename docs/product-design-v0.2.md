# Japan Atlas Product Design v0.2

Status: implementation baseline
Last updated: 2026-09-06

## Product promise

Give Andy one trustworthy, personal map of food, activities, exhibitions, and
architecture discovered across social platforms. The system should do the
collection work, show its evidence, ask only when uncertain, and remain quick
enough to use during normal life.

## Non-negotiable behavior

1. No unlabeled demo data in the working product.
2. A place is not trusted until its exact identity and branch are supported by
   evidence.
3. Japanese names are the default display names; Japanese, Chinese, and English
   source text is preserved without automatic translation.
4. Tabelog score and the personal rating are visually and semantically separate.
5. Reservation information always includes its channel, rule, source, and
   checked time; unknown values remain unknown.
6. Activities/exhibitions show official URL and date range.
7. Every user-visible action must either work or be explicitly marked pending.
8. The agent and the website modify the same durable records through the same
   operations.

## Primary flows

### Nearby decision

Andy taps “Ask nearby” or sends a WeChat location. The product sorts trusted
records by distance, filters against constraints, and returns a short sourced
list. If location permission is denied, it explains the issue instead of doing
nothing.

### Creator import

Andy provides one creator profile/ID. The product creates a durable job, the
local logged-in collector discovers posts, media extraction creates candidate
places, and only high-confidence or confirmed records reach the map.

### Place review and correction

The detail view shows Japanese title, description, address, source links,
Tabelog snapshot, reservation channel/window, and freshness. Andy can change
the title, description, and personal state. Identity corrections remain a
separate reviewed operation so personal edits cannot silently change branches.

### Visit journal

Andy chooses a place, date, personal score, and note. The entry survives sessions
and is available to the agent. Photos are the next storage slice.

## Current screen model

| Screen | Current behavior | Next addition |
|---|---|---|
| Map | Search, filters, distance ordering, source links, edit details | Map bounds query, multiple markers, review overlays |
| Inbox | Persists creator import requests and statuses | Collector progress, evidence cards, accept/reject/merge |
| Journal | Persists date, personal rating, and note | Photo upload, dish-level notes, revisit summaries |
| Agent | HTTP/WebMCP operations use the same actions | OpenClaw/WeChat channel and service authentication |

## Real-data display contract

Restaurant card:

- Japanese display title and optional alternate name;
- area/address;
- Tabelog score, review count, direct link, checked date;
- official link;
- booking channel/link;
- reservation requirement and booking horizon;
- release note and checked date;
- verification status and source links.

Non-Japan restaurants use Google Maps/Google reviews instead of Tabelog.

Event/building card:

- official title, location, and official URL;
- architect/venue context when sourced;
- start/end dates for events and exhibitions;
- ticket/reservation mode;
- checked date and expiry handling.

## Interaction states

Every asynchronous action has `idle`, `working`, `success`, and `error` states.
Imports add `needs_review` and `partial`. The UI keeps partial results and never
converts a connector failure into an empty successful job.

## What is feasible now

- creator-page discovery through a user-controlled logged-in browser;
- batch metadata capture from Xiaohongshu/Bilibili/YouTube where the rendered
  profile exposes it;
- OCR/ASR/keyframe extraction and evidence-backed candidate search;
- D1-backed edits, queues, and journal;
- Tabelog/official/booking-page snapshots and links;
- WeChat messages through Tencent's OpenClaw plugin after deployment testing.

## What remains difficult

- reliably discovering every historical post when platforms paginate, throttle,
  or alter login challenges;
- exact branch inference from generic food footage with no unique visual/textual
  evidence;
- deriving a booking-release rule from an availability calendar when the
  restaurant does not publish the rule;
- continuously running logged-in social collection in the cloud without
  increasing account risk;
- making restaurant reservations autonomously, which is intentionally out of
  scope until confirmation, cancellation, and payment safeguards exist.
