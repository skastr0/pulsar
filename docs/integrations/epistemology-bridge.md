# Epistemology bridge interface

## Purpose

Expose codec state to the same system-prompt surface used by the epistemology framework without coupling the codec to framework internals.

## Interface

The plugin injects this tagged block into `experimental.chat.system.transform` output:

```text
<taste-codec-epistemology-context schema="taste-codec/epistemology-bridge/v1">
{ ... qualitative JSON payload ... }
</taste-codec-epistemology-context>
```

## Payload shape

```json
{
  "schema_id": "taste-codec/epistemology-bridge/v1",
  "backpressure": "green|yellow|red",
  "observed_epistemology_rules": ["rule-id"],
  "agent_diagnostics": {
    "generated-slop": ["Epistemology rule no-raw-sql fired 1 time(s) in the last 14 days"]
  },
  "notes": [
    "Optimize for the concrete diagnostics below, not for any hidden codec number."
  ]
}
```

## Evidence source

- framework policy-violation packets under `.agents/messages/`
- persisted codec time-series under `.taste-codec/time-series/`

## Phase 1 scope

- policy-violation packets are the evidence seam
- no fork or mutation of the epistemology framework plugin is required
- if the framework is absent, the bridge emits nothing and the registry adds no `EPIST-*` signals
