# Part 4: Monitoring & Observability Answers

Task: Design a monitoring strategy for your integration service.

## 1. What metrics would you track?

### Service-Level Metrics (RED Method)

**Request Rate (requests/sec)** - Understand traffic patterns, detect sudden drops (potential outage) or spikes (traffic surge, DDoS, marketing campaign). Break down by endpoint: /initiate, /webhook, /status.

**Error Rate (% of requests)** - Critical. Measures service health. >1% error rate requires immediate investigation. Break down by HTTP status code (4xx vs 5xx) and by endpoint.

**Request Duration (latency)** - User experience degradation often precedes total failure. Track p95, p99, and p50. A p99 > 3 seconds indicates performance problem.

### Dependency Metrics (Four Golden Signals)

**ASPIn API Latency & Error Rate** - Our service is only as reliable as our dependencies. If ASPIn authentication fails or payment updates are slow, we need to know immediately.

**PaymentHub Webhook Delivery Lag** - Time between payment completion in PaymentHub and webhook receipt in our service. >60 seconds delays impact customer experience (policy activation delay).

**PaymentGateway Success Rate** - Percentage of M-Pesa/Airtel payment initiations that succeed. Drop below 95% indicates integration problem with specific mobile money provider.

### Business Metrics

**Payment Success Rate** - Percentage of initiated payments that reach "completed" status. This is the ultimate measure of our value to ASPIn. Target >98%.

**Average Payment Value** - KES amount per transaction. Detects currency issues, incorrect amount formatting (cents vs whole currency).

**Policy Activation Delay** - Time from payment completion to ASPIn policy activation. Business KPI directly impacting customer satisfaction.

### Operational Metrics

**Idempotency Cache Hit Ratio** - % of duplicate webhooks successfully rejected. Low ratio indicates idempotency issues → risk of duplicate payment processing.

**Webhook Signature Validation Failure Rate** - Sudden spike indicates secret rotation problem or configuration drift.

**OAuth Token Refresh Success Rate** - ASPIn tokens expire every ~25 minutes. Failure to refresh tokens = complete service outage.

**Active Connections / Goroutines** - Resource exhaustion detection before it crashes the service.

## 2. What alerts would you set up?

### PagerDuty / On-Call Engineer (Wake someone up, 24/7)

- When Error Rate > 5% with a threshold of 5% of requests over 5 minutes since service is degraded, customers are impacted. Wake up on-call.

- When p99 Latency > 5 seconds with a threshold of over 5 minutes because users are experiencing severe slowdowns.

- When Payment Success Rate < 95%, the threshold being Over 10 minutes, because of business metric failure. Payments are failing.

- When ASPIn API 401/403 > 1% with a threshold of over 5 minutes due to OAuth token failure. Imminent service outage.

- When Webhook Delivery Lag > 5 minutes the threshold being a single incident, payments completed but policies not activating. Customer complaints incoming.

- When Service Down (0 successful requests), with a threshold of 2 minutes. Complete outage. Highest priority.

### Slack / Email (Alert during business hours, actionable)

- Error Rate > 1%, threshold over 15 minutes on channel #alerts because of degradation, not yet critical. Investigate today.

- p95 Latency > 3 seconds, threshold over 15 minutes on channel #performance. Reason: slow but not failing.

- Idempotency Cache Hit Ratio < 50%, threshold over 1 hour, channel #alerts, because of potential duplicate processing.

- Signature Validation Failures > 0, threshold any in 5 minutes, channel #security, reason: potential webhook tampering or misconfiguration.

- PaymentGateway Timeout Rate > 2%, threshold over 10 minutes #mpesa #airtel, reason: specific provider issue.

- Low Disk Space / Memory, threshold < 20% remaining, on channel #infrastructure. Why?: Resource exhaustion warning.

- Certificate Expiry, threshold < 7 days, on channel #security-prod SSL/TLS expiry planning.

## 3. How would you use Sentry (or similar)?

Sentry is specialized for error tracking, not metrics. Metrics tell you something is wrong; Sentry tells you exactly what and where.

**We need to track 100% of these error types:**

### Category 1: Integration Failures (High Business Impact)

```javascript
// 1. ASPIn API Communication Failures
-ASPIN_AUTH_FAILED - // OAuth token exchange failure
  ASPIN_PAYMENT_REJECTED - // ASPIn rejected our payment update (validation error)
  ASPIN_TIMEOUT - // ASPIn took >10s to respond
  // 2. Payment Gateway Failures
  MPESA_INITIATION_FAILED - // STK Push could not be sent
  AIRTEL_INITIATION_FAILED - // Airtel Money API error
  PAYMENT_HUB_TIMEOUT - // Gateway did not respond
  INVALID_MSISDN_FORMAT - // Phone number failed regex validation
  // 3. Webhook Processing Failures
  WEBHOOK_SIGNATURE_INVALID - // HMAC verification failed
  WEBHOOK_DUPLICATE_DETECTED - // Idempotency hit (log as info, not error)
  WEBHOOK_PAYLOAD_INVALID; // Schema validation failure
```

### Category 2: Application Errors (Code Bugs)

```javascript
-UNHANDLED_EXCEPTION - // Catch-all for crashes
  DATABASE_CONNECTION_ERROR - // Idempotency store unavailable
  MEMORY_LIMIT_EXCEEDED - // Potential memory leak
  DEADLOCK_DETECTED; // Concurrent transaction conflict
```

### Category 3: Business Logic Violations

```javascript
-INVALID_AMOUNT - // KES payment ≠ 5000 (per requirement)
  POLICY_NOT_FOUND - // Transaction references non-existent policy
  CURRENCY_MISMATCH - // Expected KES, received something else
  DUPLICATE_TRANSACTION; // Same transaction_id within 24h (idempotency)
```

**How would I categorize them?**
By Severity (Sentry uses this for notifications):

Level When to Use Example

fatal Service cannot function. Immediate human intervention required. ASPIn OAuth completely failing
error Transaction failed. Business impact. Investigate within 1 hour. Payment initiation failed
warning Something unexpected but transaction succeeded. Investigate within 24h. Slow ASPIn response, duplicate webhook

info Expected behavior. Debugging context. Payment initiated, webhook received
debug Verbose logs. Not sent to Sentry in production. Request/response bodies

By Domain (Tags in Sentry):

```javascript
Sentry.captureException(error, {
  tags: {
    domain: "payment_gateway", // aspin, paymenthub, mpesa, airtel
    transaction_id: "TXN_123456", // For correlation
    partner: "demo", // Which partner
    gateway: "mpesa", // Which payment provider
    status_code: 500, // HTTP status if applicable
    environment: "production", // production, staging, development
  },
  user: {
    id: req.correlationId, // For tracing
  },
});
```

By Fingerprint (Grouping similar errors):

```javascript
// Instead of grouping every 500 error together:
Sentry.setFingerprint([
  "aspin-payment-failure",
  error.response?.status?.toString() || "unknown",
  transaction.partnerGuid || "unknown",
]);

// This creates separate issue groups:
// - aspin-payment-failure-401-demo
// - aspin-payment-failure-400-equity
// - aspin-payment-failure-500-unknown
```

## 4. Dashboard Design

### For Engineers: "Operations Console"

Purpose: Root cause analysis, performance debugging, capacity planning.
Refresh: Real-time (30s)
Location: Grafana / Datadog / New Relic

```text
┌─────────────────────────────────────────────────────────────────────┐
│  ASPIN INTEGRATION SERVICE - OPERATIONS DASHBOARD           [1h] [6h] [24h] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐               │
│  │   REQUEST RATE       │  │   ERROR RATE        │               │
│  │   ┌────────────┐    │  │   ┌────────────┐    │               │
│  │   │▄▄▄▄▄▄▄▄▄▄ │ 45 │  │   │ ▄▄▄       │ 1.2% │               │
│  │   │  req/s    │    │  │   │ 2xx 98.8%  │    │               │
│  │   └────────────┘    │  │   └────────────┘    │               │
│  └──────────────────────┘  └──────────────────────┘               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  LATENCY (p95, p99)                                        │  │
│  │  2.5s ┼─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐   │  │
│  │  2.0s ┼     │     │  ┌──┐     │     │     │     │     │   │  │
│  │  1.5s ┼     │     │  │  │     │  ┌──┐     │     │     │   │  │
│  │  1.0s ┼─────┼─────┼──┼──┼─────┼──┼──┼─────┼─────┼─────┤   │  │
│  │  0.5s ┼     │     │  │  │     │  │  │     │     │     │   │  │
│  │       └─────┴─────┴──┴──┴─────┴──┴──┴─────┴─────┴─────┘   │  │
│  │       09:00 09:05 09:10 09:15 09:20 09:25 09:30 09:35     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐        │
│  │ ENDPOINT    │ RATE        │ p95 LATENCY │ ERROR %     │        │
│  ├─────────────┼─────────────┼─────────────┼─────────────┤        │
│  │ /initiate   │ 22 req/s    │ 1,234 ms    │ 0.5%        │        │
│  │ /webhook    │ 18 req/s    │ 856 ms      │ 2.1% ▲      │        │
│  │ /status     │ 5 req/s     │ 234 ms      │ 0.0%        │        │
│  └─────────────┴─────────────┴─────────────┴─────────────┘        │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  DEPENDENCY HEALTH                                          │  │
│  │  [✅] ASPIn API       200 OK    avg 340ms  99.8% uptime    │  │
│  │  [✅] PaymentHub      reachable  avg 180ms  99.2% uptime    │  │
│  │  [⚠️] M-Pesa API      5% timeout   avg 2.1s  94% success   │  │
│  │  [✅] Airtel Money    reachable  avg 240ms  98% success    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  TOP 5 ERRORS (last 1 hour)                                 │  │
│  │  • WEBHOOK_SIGNATURE_INVALID      - 47 occurrences  🔴     │  │
│  │  • MPESA_TIMEOUT                 - 23 occurrences  🟡     │  │
│  │  • INVALID_AMOUNT               - 12 occurrences  🟢     │  │
│  │  • ASPIN_AUTH_FAILED            - 8 occurrences   🔴     │  │
│  │  • POLICY_NOT_FOUND             - 5 occurrences   🟡     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  RECENT DEPLOYMENTS                                         │  │
│  │  v1.2.3 - 2026-02-12 09:15 - ✅ Success (5m health check)  │  │
│  │  v1.2.2 - 2026-02-11 14:30 - ✅ Success                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
Engineer Dashboard KPIs:

RED metrics (Rate, Errors, Duration) for every endpoint

Dependency health (ASPIn, PaymentHub, M-Pesa, Airtel)

Top errors (drill down to Sentry)

Deployment marker (correlate changes with performance)

Instance health (CPU, Memory, GC, connections)

```

### For Support Team: "Customer Support Console"

Purpose: Answer customer questions, investigate individual transactions, identify partner issues.
Refresh: Near real-time (60s)
Location: Custom internal tool / Retool / Grafana

```text
┌─────────────────────────────────────────────────────────────────────┐
│  SUPPORT DASHBOARD - TRANSACTION & PARTNER VIEW                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🔍 SEARCH                                     [ Correlation ID ]  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ [CUST_7890] [TXN_123456] [policy_guid] [msisdn]    [SEARCH]│  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  TRANSACTION DETAILS                                      │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐       │   │
│  │  │ Transaction ID      │  │ TXN_123456         │       │   │
│  │  │ Status              │  │ ✅ Completed       │       │   │
│  │  │ Amount              │  │ KES 5,000          │       │   │
│  │  │ Gateway             │  │ M-Pesa             │       │   │
│  │  │ Created At          │  │ 2026-02-12 09:15:23│       │   │
│  │  └─────────────────────┘  └─────────────────────┘       │   │
│  │                                                          │   │
│  │  ⏱️ TIMELINE                                           │   │
│  │  09:15:23 - Payment initiated                         │   │
│  │  09:15:25 - M-Pesa STK Push sent                      │   │
│  │  09:15:45 - Customer entered PIN                      │   │
│  │  09:15:47 - Payment completed                         │   │
│  │  09:15:49 - Webhook received from PaymentHub          │   │
│  │  09:15:52 - ASPIn notified (200 OK)                   │   │
│  │  09:15:53 - Policy activated                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  PARTNER HEALTH (Last 24h)                                 │   │
│  │                                                             │   │
│  │  Partner      | Payments | Success % | Avg Latency | Alerts│   │
│  │  ───────────────────────────────────────────────────────   │   │
│  │  🏢 Demo      | 1,234    | 98.5%     | 1.2s       | 0     │   │
│  │  🏢 Equity    | 567      | 97.2%     | 1.8s       | 2     │   │
│  │  🏢 Britam    | 234      | 99.1%     | 0.9s       | 0     │   │
│  │  🏢 Airtel RW | 89       | 94.3% 🔻  | 2.4s 🔻    | 5 🔴  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ⚠️ ACTIVE INCIDENTS (2)                                          │
│  • Airtel Rwanda - 23% timeout rate - Investigating              │
│  • Webhook signature failures - 47 in last hour - Rotating secret│
└─────────────────────────────────────────────────────────────────────┘
Support Dashboard KPIs:

Transaction search (by any identifier)

Transaction timeline (end-to-end flow visualization)

Partner health scores (success rate by partner)

Active incidents (linked to alert system)

Customer impact (how many policies delayed?)

```

### For Management: "Business KPI Dashboard"

Purpose: Track business outcomes, SLA compliance, partner growth.
Refresh: Hourly / Daily
Location: Tableau / PowerBI / Google Data Studio

```text
┌─────────────────────────────────────────────────────────────────────┐
│  PAYMENT INTEGRATION - EXECUTIVE SUMMARY              [Today] [Week]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐                 │
│  │   TOTAL PAYMENTS    │  │   PAYMENT VOLUME    │                 │
│  │   ┌─────────────┐   │  │   ┌─────────────┐   │                 │
│  │   │   1,234     │   │  │   │ KES 6.2M    │   │                 │
│  │   │ transactions│   │  │   │ processed   │   │                 │
│  │   └─────────────┘   │  │   └─────────────┘   │                 │
│  └─────────────────────┘  └─────────────────────┘                 │
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐                 │
│  │   SUCCESS RATE      │  │   AVG ACTIVATION    │                 │
│  │   ┌─────────────┐   │  │   ┌─────────────┐   │                 │
│  │   │   98.2%     │   │  │   │    45s      │   │                 │
│  │   │   ▲ +0.5%   │   │  │   │ policy delay│   │                 │
│  │   └─────────────┘   │  │   └─────────────┘   │                 │
│  └─────────────────────┘  └─────────────────────┘                 │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  PAYMENT VOLUME TREND (Last 30 Days)                       │   │
│  │  KES 8M ┤                                                │   │
│  │        ┤      ███                                        │   │
│  │  KES 6M ┤   █████  ███     █████  ███   █████           │   │
│  │        ┤ ███████████████ ████████████████████████       │   │
│  │  KES 4M ┤███████████████████████████████████████████    │   │
│  │        └────────────────────────────────────────────    │   │
│  │         W1   W2   W3   W4   W5   W6   W7   W8   W9      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SLAs & OBJECTIVES                                         │   │
│  │                                                             │   │
│  │  Metric              Target    Current     Status          │   │
│  │  ───────────────────────────────────────────────────────   │   │
│  │  Payment Success     99.0%     98.2%       🟡 -0.8%       │   │
│  │  Policy Activation   <60s      45s         ✅  Good       │   │
│  │  Uptime (P99)        99.95%    99.98%      ✅  Good       │   │
│  │  Support Response    <15m      12m         ✅  Good       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  PARTNER BREAKDOWN (This Month)                            │   │
│  │                                                             │   │
│  │  [======= Demo 45% =======]    [== Equity 22% ==]          │   │
│  │  [=== Britam 18% ===]          [= Airtel 10% =]            │   │
│  │  [Other 5%]                                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  🏆 ACHIEVEMENTS: 7 days without critical incident               │
│  🚩 RISKS: Airtel Rwanda success rate below target (94.3%)       │
└─────────────────────────────────────────────────────────────────────┘
Management Dashboard KPIs:

Top-line business metrics (volume, value, success rate)

Trends over time (weekly/monthly growth)

SLA compliance (are we meeting our promises?)

Partner breakdown (who's using the service?)

Risk indicators (what needs executive attention?)

```

This three-tiered approach ensures:

- Engineers can detect and resolve issues quickly

- Support can answer customer questions without bugging engineering

- Management can make data-driven business decisions

Most importantly: Every metric and alert is tied to a clear action. If nobody knows what to do when an alert fires, it's just noise. Every alert in the system has a corresponding runbook with investigation steps and remediation procedures.
