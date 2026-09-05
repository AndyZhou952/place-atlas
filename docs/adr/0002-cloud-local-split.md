# ADR 0002: Split Always-On Cloud Services from Local Browser Acquisition

Status: proposed
Date: 2026-09-05

## Context

WeChat interaction, reminders, the map, and the personal database need to remain
available while Andy travels and the laptop is asleep. Logged-in Xiaohongshu and
Bilibili browser automation is fragile, account-sensitive, and may require
CAPTCHA or manual recovery. Sending browser cookies to a VPS would increase risk.

## Decision

Run the WeChat gateway, API, database/storage, lightweight workers, and reminders
in the cloud. Run logged-in social browser acquisition on Andy's Mac in a
dedicated profile, only when requested. The local connector uploads normalized
evidence manifests through a narrow authenticated endpoint.

## Consequences

Positive:

- daily product remains available 24/7;
- social cookies and browser control stay local;
- CAPTCHA/login problems do not take down recommendations;
- the cloud server stays small and inexpensive;
- connectors can be replaced independently.

Negative:

- bulk imports pause when the Mac is offline;
- two execution environments need a small synchronization protocol;
- raw-video local preprocessing needs resumable upload/status behavior.

## Revisit when

- an official API replaces browser access;
- a connector is proven safe and stable in isolated cloud browsing;
- local availability prevents a required import schedule;
- the product becomes multi-user and needs managed connector workers.
