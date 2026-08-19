# PostHog Self-driving Setup Report

_Generated 2026-08-19 for project `pondview-forecast` (PostHog project 566336)_

## Summary

PostHog Self-driving is now configured for the Pondview Pool Forecaster. Session Replay, Error Tracking, Support, and Health Check signal sources are enabled; five scouts are running (general plus four specialists for web traffic, product analytics, web vitals, and observability gaps); and two Replay Vision scanners are armed to push findings directly into the inbox. Findings will start appearing in the Self-driving inbox within ~30 minutes: https://us.posthog.com/project/566336/inbox

## AI data processing

**Approved.** Organization-level AI data processing consent was confirmed before this run.

## GitHub

**Connected during this run.** Integration id 233417, GitHub account `isaacwillson`. One repository connected — this will be the default for any future GitHub Issues source.

## Products enabled

The `products-enable` tool was not available on this PostHog deploy. The `posthog.init` in `web/components/PostHogSetup.tsx` was checked and is clean (no `disable_session_recording` or `capture_exceptions: false` overrides).

| Product | Status | Notes |
|---|---|---|
| Session Replay | **Follow-up required** | Enable in PostHog Settings → Session Replay ("Record user sessions") |
| Error Tracking | **Enabled in SDK** | `capture_exceptions: true` is set in `posthog.init`; confirm toggle in Settings → Error Tracking |
| Support (Conversations) | **Follow-up required** | Enable via the product sidebar in PostHog; then connect an inbound channel (see Follow-ups) |

## Signal sources

| Source product | Source type | Action | ID |
|---|---|---|---|
| `signals_scout` | `cross_source_issue` | **ON by default** — no row needed | — |
| `health_checks` | `health_issue` | **Enabled** | `01a01b23-7d8c-75c5-bcba-28a6d3451ac8` |
| `error_tracking` | `issue_created` | **Enabled** | `01a01b23-82f2-75b5-bba0-cf7ab89363f8` |
| `error_tracking` | `issue_reopened` | **Enabled** | `01a01b23-85de-79c3-bfdf-5f4f6b824748` |
| `error_tracking` | `issue_spiking` | **Enabled** | `01a01b23-8b64-7a52-9399-fe5991e70920` |
| `session_replay` | `session_analysis_cluster` | **Enabled** (server default: 10% sample rate) | `01a01b23-8dd8-77d3-9d64-73ffe6051df7` |
| `conversations` | `ticket` | **Enabled** (dormant until inbound channel connected) | `01a01b23-919d-7983-8a65-5a2343e50e12` |
| `replay_vision` | — | **Skipped** — scanners are self-authorizing via `emits_signals` flag; no config row needed |  |
| `llm_analytics` | — | **Skipped** — not a v1 responder |  |
| `logs` | — | **Skipped** — not a v1 responder |  |

## Connected tools

| Tool | Status |
|---|---|
| GitHub Issues | Not used (user skipped) |
| Linear | Not used (user skipped) |
| Jira | Not used (user skipped) |
| Sentry | Not used (user skipped) |
| Zendesk | Not used (user skipped) |

## Scout troop

**Run budget**: 100 runs/day (early access default). 0 runs used today. Max 3 runs per tick.  
**Banner**: _"Scouts are in early access. Each project gets up to 100 scout runs a day. Contact team-self-driving@posthog.com if you need more."_

### Enabled (5 scouts)

| Scout | Reason enabled |
|---|---|
| `signals-scout-general` | Always on — sweeps cross-product correlations and surfaces no specialist covers |
| `signals-scout-web-analytics` | Public-facing web app; channel session volume, attribution, and landing-page health are core |
| `signals-scout-product-analytics` | Custom events (tab_switched, forecast_day_selected, suggested_question_clicked) form a watchable product funnel |
| `signals-scout-web-vitals` | Next.js app where Core Web Vitals directly affect the forecast load UX |
| `signals-scout-observability-gaps` | Fresh project; good to have uncovered event volumes surfaced as insight/dashboard gaps |

### Disabled (22 scouts)

| Scout | Reason |
|---|---|
| `signals-scout-error-tracking` | **Covered by native source** — `error_tracking` source rows handle this; a scout would duplicate it |
| `signals-scout-session-replay` | **Covered by native source** — `session_replay` source and Replay Vision scanners handle this |
| `signals-scout-feature-flags` | Not in use — no feature flag calls in codebase |
| `signals-scout-surveys` | Not in use — 0 surveys in project |
| `signals-scout-revenue-analytics` | Not in use — no payment SDK |
| `signals-scout-ai-observability` | Not in use — no `$ai_*` events or LLM analytics SDK |
| `signals-scout-experiments` | Not in use — no active experiments |
| `signals-scout-logs` | Not in use — logs product not active |
| `signals-scout-csp-violations` | Not configured — no CSP reporting |
| `signals-scout-customer-analytics` | Not applicable — B2C public app, no account/group analytics |
| `signals-scout-data-pipelines` | Not in use — no CDP destinations or batch exports |
| `signals-scout-data-warehouse` | Not in use — no external warehouse sources |
| `signals-scout-replay-vision` | Skipped — no accumulated observations yet from the new scanners |
| `signals-scout-conversations` | Skipped — Conversations product has no inbound channel yet |
| `signals-scout-anomaly-detection` | Disabled — no dashboards/insights yet to watch |
| `signals-scout-health-checks` | Disabled — health_checks native source already active |
| `signals-scout-inbox-validation` | Disabled — fresh setup, no resolved reports to validate |
| `signals-scout-insight-alerts` | Disabled — no alerts configured |
| `signals-scout-mcp-tool-calls` | Disabled — not applicable |
| `signals-scout-apm` | Disabled — no distributed tracing |
| `signals-scout-tasks` | Disabled — not applicable |
| `signals-scout-skills-store` | Disabled — not applicable |

Re-enable follow-ups: `signals-scout-feature-flags` if you add feature flags; `signals-scout-experiments` if you run A/B tests; `signals-scout-surveys` if you add PostHog surveys; `signals-scout-logs` if you enable the logs product.

## Custom scouts

**Proposed**: one candidate — _Watch the forecast API for errors and degradation_ — that would monitor `forecast_error_retried` / `forecast_day_selected` ratio spikes.

**Declined by user.** The built-in troop covers this project.

**Surfaces considered and ruled out**:
- _Ask tab engagement_ — events from ChatView's question submission / response flow were not fully confirmed; surface not ready (missing event evidence).
- _What-If tool usage_ — only `whatif_day_type_changed` confirmed; not enough for a meaningful scout.

**Noise escape hatch**: if any enabled scout turns out noisy, set `emit: false` on its config in PostHog to switch it to dry-run without disabling it.

## Replay Vision scanners

Replay Vision scanners are LLM agents that watch individual session recordings on a schedule and push what they find straight into the Self-driving inbox. Findings arrive at half weight, so they need corroboration before they're promoted into a report.

The project currently has no recordings — the scanners are armed and start working the day recordings begin (no second setup needed).

Credit spend was not verified (the `creating-replay-vision-scanners` sizing skill was unavailable on this deploy). Both scanners use `gemini-3.7-flash` at 15 credits per observation; estimated monthly credits are $0 until recordings exist.

### Scanner 1 — Broken experiences

| Field | Value |
|---|---|
| ID | `01a01b27-f1af-7568-80db-71750daa9e4c` |
| Type | `monitor` |
| `emits_signals` | `true` |
| Scope | `$current_url icontains "pondviewforecast.vercel.app"` — the entire site |
| `sampling_rate` | 0.5 |
| Model | `gemini-3.7-flash` (15 credits/observation) |
| Estimated monthly credits | 0 (no recordings yet) |

**Why this scope**: this is a single-page app with no distinct checkout or sub-path for the completion flow; the entire forecaster lives at one URL, so the meaningful "completion flow" is the forecast view loading and displaying the hourly chart. URL scoping to the full domain targets the product's only surface without being vague.

### Scanner 2 — User frustration

| Field | Value |
|---|---|
| ID | `01a01b28-0160-7341-abcc-ee4acdba911c` |
| Type | `monitor` |
| `emits_signals` | `true` |
| Scope | Sessions with `$rageclick` events only |
| `sampling_rate` | 1.0 |
| Model | `gemini-3.7-flash` (15 credits/observation) |
| Estimated monthly credits | 0 (no recordings yet) |

**Why `$rageclick` only**: the frustration gate is narrow and high-precision; 100% sampling is affordable because the gate is tight. No URL scope added — that would risk overlapping with Scanner 1 (both would then analyze sessions from the same URL, letting a single defect corroborate itself into a promoted report).

## Follow-ups

- [ ] **Enable Session Replay** in PostHog: Settings → Session Replay → "Record user sessions"
- [ ] **Enable Error Tracking** in PostHog: Settings → Error Tracking → "Enable exception autocapture" _(SDK already has `capture_exceptions: true`)_
- [ ] **Enable Support (Conversations)** in PostHog: click Support in the product sidebar
- [ ] **Connect an inbound channel for Conversations** (email / inbox / Slack) so support tickets start reaching the Self-driving inbox — the responder row is already enabled and will activate automatically once a channel exists
- [ ] **Verify Replay Vision credit spend** once recordings begin — check estimated monthly credits in PostHog → Replay Vision → scanner settings, and set a `credit_limit` if needed
- [ ] _(Optional)_ **Enable `signals-scout-replay-vision`** once the scanners have accumulated observations to trend over

## What happens next

The scout coordinator picks up fresh configs within ~30 minutes. Each enabled scout runs daily and draws from your 100-run daily budget. Scout findings cluster into reports in the inbox; immediately actionable ones can automatically start coding tasks. Replay Vision scanners sweep matching recordings every 5 minutes and push defects directly to the inbox once recordings exist.

Visit your inbox: https://us.posthog.com/project/566336/inbox
