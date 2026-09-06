# Japan Personal Atlas

A private, map-first assistant for turning Andy's saved Japan food, event, and
architecture discoveries into nearby recommendations, reservation reminders,
and a long-term personal journal.

The repository contains the private web product, durable data foundation, and
the product/engineering design for the collector and WeChat agent.

## Design documents

- [Product brief](docs/product-brief-v0.1.md)
- [Product design v0.2](docs/product-design-v0.2.md)
- [System architecture and harness selection](docs/architecture.md)
- [Data ingestion and place identity resolution](docs/data-ingestion-and-identity-resolution.md)
- [Evaluation plan](docs/evaluation-plan.md)
- [Delivery roadmap](docs/roadmap.md)
- [Legacy `food-map` audit](docs/legacy-food-map-audit.md)
- [Time-sensitive research notes](docs/research-notes-2026-09-06.md)
- [Decision log](docs/decision-log.md)
- [ADR 0001: OpenClaw as channel gateway](docs/adr/0001-openclaw-channel-gateway.md)
- [ADR 0002: Cloud/local split](docs/adr/0002-cloud-local-split.md)
- [ADR 0003: Durable Atlas API](docs/adr/0003-durable-atlas-api.md)

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

The private map now has working Map, Inbox, and Journal views; source-checked
records; dated Tabelog/reservation facts; editable personal fields; durable D1
storage; and shared HTTP/WebMCP operations. Web Access is installed locally for
the next collector experiment. The collector worker and OpenClaw/WeChat channel
are not connected yet and are shown as pending in the product.
