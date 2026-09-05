# Japan Personal Atlas

A private, map-first assistant for turning Andy's saved Japan food, event, and
architecture discoveries into nearby recommendations, reservation reminders,
and a long-term personal journal.

This repository currently contains the product and engineering design. The
first implementation milestone is a small end-to-end pilot; it is intentionally
not yet a collection of framework-specific agent code.

## Design documents

- [Product brief](docs/product-brief-v0.1.md)
- [System architecture and harness selection](docs/architecture.md)
- [Data ingestion and place identity resolution](docs/data-ingestion-and-identity-resolution.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Delivery roadmap](docs/roadmap.md)
- [Legacy `food-map` audit](docs/legacy-food-map-audit.md)
- [Decision log](docs/decision-log.md)
- [ADR 0001: OpenClaw as channel gateway](docs/adr/0001-openclaw-channel-gateway.md)
- [ADR 0002: Cloud/local split](docs/adr/0002-cloud-local-split.md)

## Current recommendation

Use OpenClaw as the replaceable 24/7 WeChat gateway and initial agent runtime,
but keep all durable product data and business rules in a framework-neutral
domain service. Run the user-facing gateway and API in the cloud; run fragile
logged-in browser acquisition locally and only when requested.

Do not choose the harness by asking which one can identify restaurants best.
Identity accuracy belongs to a separately evaluated evidence and entity-
resolution pipeline. The harness evaluation covers channel reliability, tool
execution, recovery, security, maintenance, and cost.

## Status

Foundation implementation phase. GitHub access is restored and the legacy map
has been audited. No harness, browser automation skill, or cloud resource has
been installed or provisioned yet.
