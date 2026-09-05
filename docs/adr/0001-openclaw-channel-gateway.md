# ADR 0001: Use OpenClaw as the Replaceable Channel Gateway

Status: proposed
Date: 2026-09-05

## Context

The product needs an always-on WeChat direct-message interface with text,
images, voice, and location. OpenClaw documents an external Tencent Weixin
plugin and provides gateway, skills/plugins, schedules, model providers, and
operations features. Hermes has attractive personal memory/skills but no
documented WeChat channel. Pi, Codex, and Claude Code are coding-oriented.
OpenAI and Claude agent SDKs support production loops but do not supply the
channel gateway.

## Decision

Use OpenClaw for the v1 WeChat gateway and first orchestration loop, subject to
the runtime evaluation and seven-day soak.

Keep it behind `ChannelAdapter` and `AgentRuntime`. OpenClaw receives only scoped
domain tools and is not permitted unrestricted production shell, filesystem, or
browser access.

## Consequences

Positive:

- shortest route to the desired daily interaction;
- model and skill/plugin flexibility;
- built-in long-running gateway concepts;
- avoids building a WeChat transport before validating the product.

Negative:

- the external WeChat plugin is a versioned operational dependency;
- OpenClaw defaults must be hardened because host execution can otherwise be
  broad;
- the project must test reconnection and account behavior empirically;
- a thin adapter layer adds some initial code.

## Alternatives

- Hermes: keep as the first challenger for memory/skill behavior; requires a
  WeChat bridge.
- OpenAI Agents SDK or Claude Agent SDK: choose if code-owned control,
  observability, or approval semantics outweigh channel implementation cost.
- Pi/custom loop: choose only if minimalism and full customization later become
  more important than time to a reliable v1.

## Revisit when

- runtime gates fail;
- WeChat plugin maintenance becomes unreliable;
- OpenClaw cannot expose adequate trace/replay data;
- a second channel makes a code-owned channel service economical;
- framework restrictions block a required agent interaction.
