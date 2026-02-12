# Part 3: Debugging & Troubleshooting Answers

## Bug Report 1: Duplicate Customer Registrations

**From:** PartnerCRM
**Subject:** Duplicate customer registrations
**Description:** We're receiving the same customer registration request multiple times from the partner within seconds. This is creating duplicate records in our system.

Example:

- Customer ID: CUST_7890

- Received 3 identical requests at: 10:30:15, 10:30:17, 10:30:19

### 1. What are the possible root causes?

**Missing idempotency implementation -** Neither ASPIn nor PartnerCRM is implementing idempotency keys. The same request is sent multiple times and each is treated as a new registration.(Priority HIGH)
**Client-side retry on timeout -** ASPIn's API client is configured to retry on network timeouts or 5xx responses. The 2-second interval suggests a retry policy with fixed delay.(Priority HIGH)
**User double-click / UI issue -** End-user clicked "Submit" multiple times, triggering multiple API calls.(Priority MEDIUM)
**Load balancer duplication -** Proxy or load balancer forwarding the same request twice.(Priority MEDIUM)
**Race condition -** Concurrent requests checking "customer exists" simultaneously, both proceeding to insert.
**TCP packet retransmission -** Network-level duplication, unlikely to create 3 identical application-level requests.

**My assessment:** The pattern of 3 requests within 4 seconds strongly indicates an automated retry mechanism. The identical timings (2 seconds apart) suggest fixed-interval retries rather than exponential backoff. Combined with the absence of idempotency, this is a most certainly an integration failure.

### 2. What questions would you ask each party?

#### To PartnerCRM (the receiver):

1. Do all three requests contain the same Idempotency-Key header? If not, what values do you see?

2. What HTTP status code did you return for the first request? Was it a 202 Accepted, 200 OK, or a 5xx error?

3. How long did it take your system to process and respond to the first request? Was it >2 seconds?

4. Does your registration endpoint check for existing customers before creating a new record? If yes, what unique identifier are you using?

5. Is your registration endpoint idempotent? If we send the exact same payload twice, what is the expected behavior?

6. Do you have rate limiting configured? Could ASPIn be retrying because they received a 429 for Too Many Requests?

#### To ASPIn Backend (the sender):

1. What is your retry policy for POST requests to PartnerCRM? Which HTTP status codes trigger a retry? What is the delay between attempts?

2. Are you generating and sending an Idempotency-Key header? If yes, is it the same key across all retry attempts or a new key each time?

3. Do you have client-side timeouts configured? What is the threshold?

4. Can you share your application logs from 10:30:15 showing the outgoing requests and any responses received?

5. Is this behavior isolated to PartnerCRM or are you seeing similar patterns with other integration partners?

6. Do you implement optimistic locking or unique constraints on your side to prevent duplicate customer records?

### 3. What logs/data would you check?

#### From PartnerCRM:

**- Web server access logs -** Timestamps, HTTP status codes, response times for the 3 requests
**- Application logs -** Full request headers (especially Idempotency-Key, X-Request-ID), stack traces, database queries
**- Database audit logs INSERT statements showing duplicate customer records, timestamps
**- Idempotency store If exists, check if keys were recorded and for how long
\*\*- Error logs Timeout warnings, connection resets, deadlock exceptions

#### From ASPIn Backend:

**- Outbound HTTP logs -** Full request/response cycle for each attempt to PartnerCRM
**- Retry mechanism logs -** What triggered the retry? (timeout, 5xx, 429)
**- Configuration files -** RETRY_MAX_ATTEMPTS, RETRY_DELAY, TIMEOUT_MS values
**- Correlation IDs -** Do all 3 requests share the same trace ID or different ones?
**- Error logs -** Any exceptions during the registration flow

#### From Infrastructure:

**- Load balancer logs -** Duplicate request forwarding, backend response times
**- Network traces -** TCP retransmissions, connection resets
**- CDN logs -** If applicable, cached responses vs origin requests

### 4. How would you investigate? (Step-by-step)

#### Phase 1: Immediate Triage

**- Acknowledge and prioritize** — Confirm with PartnerCRM that this is actively impacting their system and customer data integrity.

**- Isolate the scope** — Ask PartnerCRM: "Is this happening for all customers or only specific ones? When did this start?"

**- Extract forensic data** — Request PartnerCRM to provide:

    - Full headers of all 3 requests (redacted PII)
    - Response status codes and bodies they returned
    - Exact timestamps with millisecond precision

**- Quick wins** — Check if PartnerCRM has a unique constraint on natural keys (e.g., partner_id + external_customer_id). If not, this is an immediate recommendation.

#### Phase 2: Root Cause Analysis

1. Examine idempotency headers:

- Case A: All 3 requests have the same Idempotency-Key → PartnerCRM failed idempotency (did not store/check the key).

- Case B: All 3 requests have different Idempotency-Key → ASPIn is generating new keys per retry, defeating the purpose.

- Case C: No Idempotency-Key header → Neither side implemented idempotency.

2. Analyze response times and status codes —

```bash

# Example log analysis (pseudo-code)

grep "CUST_7890" partnercrm-access.log | awk '{print $4, $9, $10}'

# Output: 10:30:15 202 2500ms

# Output: 10:30:17 202 180ms

# Output: 10:30:19 202 195ms

```

If first request took >2 seconds, ASPIn's client likely timed out and initiated retry.

If first response was 5xx, retry is expected. If 2xx, retry is a bug.

Reproduce in test environment —

Set up mock PartnerCRM endpoint with artificial delay (2500ms)

Configure ASPIn test client with production retry settings

Send registration request and observe behavior

Review ASPIn retry configuration —

```javascript
// Suspected configuration
{
retry: {
attempts: 3,
delay: 2000, // Fixed delay, not exponential
statusCodes: [408, 429, 500, 502, 503, 504] // May include 2xx erroneously
}
}

```

#### Phase 3: Deep Dive (If needed)

**Enable debug logging** — Ask both teams to temporarily increase log verbosity for registration endpoints.

**Distributed tracing** — Ensure correlation IDs propagate across service boundaries. If missing, implement X-Request-ID header propagation.

**Database concurrency test** — Simulate concurrent registration requests to test for race conditions.

### 5. Propose a solution and prevention strategy

The Immediate Fix is to "Stop the bleeding":

PartnerCRM: Implement idempotency on the receiver side — This is the most critical fix.

```sql
-- Create idempotency store
CREATE TABLE idempotency_keys (
idempotency_key VARCHAR(36) PRIMARY KEY,
response JSON NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
expires_at TIMESTAMP GENERATED ALWAYS AS (created_at + INTERVAL 24 HOUR),
INDEX (expires_at)
);

-- API logic
function handleRegistration(request):
key = request.headers['Idempotency-Key']
if !key: return 400 "Idempotency-Key required"

cached = db.findIdempotencyKey(key)
if cached: return 202 cached.response

response = processRegistration(request)
db.saveIdempotencyKey(key, response)
return 202 response
PartnerCRM: Add database unique constraint — Immediate protection against duplicates.

```

````sql

ALTER TABLE customers
ADD CONSTRAINT unique_partner_customer
UNIQUE (partner_guid, external_identifier);
ASPIn Backend: Fix retry logic immediately —

```javascript

// Before (problematic)
axios.post(url, data, {
retry: 3,
retryDelay: 2000 // Fixed delay
});

// After (fixed)
axios.post(url, data, {
retry: 3,
retryDelay: (retryCount) => {
return Math.min(1000 _ Math.pow(2, retryCount) + Math.random() _ 100, 10000);
}, // Exponential backoff with jitter
retryCondition: (error) => {
// Only retry on network errors or 5xx, never on 4xx
return !error.response || error.response.status >= 500;
}
});

````

ASPIn Backend: Reuse idempotency key across retries —

```javascript
const idempotencyKey = generateUUID(); // Generate once at the start

async function sendWithRetry(payload) {
  return retry(async () => {
    return axios.post(url, payload, {
      headers: { "Idempotency-Key": idempotencyKey }, // Same key every time
    });
  });
}
```

Medium-term Solution (Systemic Fix):

API Contract Enforcement —

- Update OpenAPI specification to require Idempotency-Key header for all state-changing operations

- Add automated contract tests that verify idempotency behavior

Standardize Headers Across Partners —

```yaml
# Common header specification

Idempotency-Key:
description: UUID v4 that uniquely identifies this request. Subsequent requests with the same key will return the same response.
required: true
schema:
type: string
format: uuid
```

Retry Policy Documentation —

Publish clear retry policies for all partners

Document which status codes trigger retries and the backoff algorithm

Long-term Prevention:

Monitoring and Alerting —

```promql

# Alert on duplicate idempotency keys

sum(increase(idempotency_key_duplicates_total[5m])) > 10

# Alert on high retry rates

(sum(rate(http_client_retries_total[5m])) /
sum(rate(http_client_requests_total[5m]))) \* 100 > 5

```

Chaos Engineering —

Regularly inject latency and 5xx errors in test environments

Verify retry and idempotency behavior works as expected

Post-mortem Culture —

Every idempotency failure triggers a blameless post-mortem

Action items tracked to completion

## Bug Report 2: From Aspin Backend

Subject: Payment webhooks not received
Description: We initiated 15 payments yesterday but only received webhook callbacks for 8 of them. The other 7 payments show as "completed" in PaymentHub dashboard but we never got notified.

This is blocking policy activation for customers.

### 1. What are the possible root causes?

**Webhook URL misconfiguration -** PaymentHub has an incorrect, outdated, or unreachable URL for ASPIn's webhook endpoint.

**Signature Validation Failure -** ASPIn is rejecting webhooks due to invalid/missing signature, expired secret, or algorithm mismatch.

**Network/firewall blocking -** ASPIn's webhook endpoint is down, unreachable, or returning 5xx errors.

**Idempotency false positive -** ASPIn received the webhooks but incorrectly identified them as duplicates and discarded them.

**Payload schema mismatch -** PaymentHub changed webhook payload format; ASPIn validation fails silently.

**Processing timeout -** ASPIn takes >5 seconds to respond; PaymentHub gives up and does not retry.

**SSL/TLS certificate issue -** ASPIn's SSL certificate expired; PaymentHub refuses to send to insecure endpoint.

**Rate limiting -** ASPIn throttled incoming requests; PaymentHub hit rate limit and dropped webhooks.

**IP whitelist change -** PaymentHub updated their egress IPs; ASPIn firewall blocks new ranges.

**My Assessment: -** A 47% failure rate (7/15) indicates a systematic issue, not random packet loss. The fact that 8 webhooks succeeded means the endpoint is sometimes reachable but not consistently. This points to intermittent validation failures or partial configuration errors.

### 2. What questions would you ask each party?

#### To PaymentHub (the sender):

1. Do your delivery logs show that webhooks were sent for all 15 transactions? If yes, what HTTP status codes did ASPIn return for each attempt?

2. What webhook URL do you have registered for ASPIn? When was it last updated and by whom?

3. Do you have retry logic configured? How many retry attempts were made for the failed deliveries? What were the response codes on retries?

4. Did any of these webhooks fail signature generation on your end before sending?

5. Can you provide the exact timestamps of when the 7 failed webhooks were attempted?

6. Is there a webhook delivery dashboard you can grant us read-only access to?

#### To ASPIn Backend (the receiver):

1. Do your access logs show incoming POST requests to /webhooks/payment between yesterday 00:00-23:59? Can you filter by the 7 transaction IDs?

2. Are you validating webhook signatures? If yes, what algorithm (HMAC-SHA256?) and when was the last secret rotation?

3. Do you have idempotency implemented? Could you be receiving the webhooks but discarding them as duplicates?

4. Were there any deployments, configuration changes, or certificate renewals yesterday between 08:00-12:00?

5. What is your timeout threshold for webhook processing? Are you responding within 5 seconds?

6. Do you have rate limiting on the webhook endpoint? What is the limit per second/minute?

#### To Our Integration Service

1. Did our service receive all 15 webhooks from PaymentHub? If not, which ones are missing from our logs?

2. For the webhooks we received, did we successfully forward them to ASPIn? What response codes did ASPIn return?

3. Did we experience any authentication failures with ASPIn around that time? Token expired?

### 3. What logs/data would you check?

#### From PaymentHub:

**Webhook delivery logs** - Timestamps, target URL, HTTP status code, response body, error message, attempt number.
**Webhook configuration** - Registered URL, shared secret, enabled events, creation/modification timestamp.
**IP logs** - Source IP addresses used to send webhooks
**Error logs** - DNS resolution failures, connection timeouts, SSL errors

#### From ASPIn Backend:

**Web server access logs** - All POST requests to webhook endpoint with status codes, response times, client IPs
**Application logs** - Stack traces during webhook processing, validation failures, business logic errors
**Idempotency store** - Keys received in the last 24 hours, TTL, original vs duplicate status
**Authentication logs** - Token validation, API key checks, rate limiting counters
**Deployment history** - Code deploys, config changes, feature flags toggled within 24h before incident

#### From This Integration Service:

**Inbound webhook logs** - All requests received from PaymentHub with headers, payload, timestamp
**Outbound ASPIn logs** - Requests sent to ASPIn, response status codes, duration
**Error logs** - Authentication failures (401), validation errors (400), timeouts
**Metrics** - Webhook latency, success rate, error rate by error code

### 4. How would you investigate? (Step-by-step)

#### Phase 1: Immediate Triage

**Confirm the scope** — Ask ASPIn: "Are you still missing webhooks for payments made today?" Determine if this is ongoing or a past incident.

**Verify the 7 missing transactions** — Log into PaymentHub dashboard. For each of the 7 transaction IDs:

Confirm status = "completed"

**Check "Webhook Status"** — "Sent", "Failed", "Pending", or "Not Configured"?

**Check our own logs first** — As the integration layer (if applicable), we should have received these webhooks.

```bash

# Quick log query
grep -E "TXN_123456|TXN_234567|TXN_345678" logs/webhooks.log

```

Scenario A: We didn't receive them → Problem is between PaymentHub and us.

Scenario B: We received them but failed to forward → Problem is between us and ASPIn.

**Test the webhook endpoint manually** —

```bash

# Test with valid signature
curl -X POST https://api.aspin.com/v1/webhooks/payment \
  -H "X-Signature: ${VALID_SIGNATURE}" \
  -H "X-Webhook-ID: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "TEST_001",
    "status": "completed",
    "amount": 5000,
    "currency": "KES",
    "timestamp": "'$(date -Iseconds)'"
  }' \
  -w "\nHTTP Status: %{http_code}\n"

```

If 200/202 → Endpoint is reachable and accepts valid requests.

If 401/403 → Signature validation issue.

If 404 → Wrong URL.

If 500 → Application error.

If timeout → Network or performance issue.

#### Phase 2: Root Cause Analysis

If PaymentHub logs show "Sent" but ASPIn has no record (Scenario A):

**Compare IP addresses** — Are PaymentHub's webhook sender IPs in ASPIn's firewall/security group whitelist?

**Check DNS** — Does api.aspin.com resolve correctly from PaymentHub's network?

**Verify SSL certificate** —

```bash

openssl s_client -connect api.aspin.com:443 -servername api.aspin.com 2>/dev/null | openssl x509 -noout -dates

```

Check if certificate is expired or not yet valid.

**Review load balancer logs** — Are requests reaching the load balancer but not being routed to application servers?

If ASPIn logs show rejected webhooks (Scenario B):

**Examine response status codes** —

- 401 Unauthorized → Signature validation failure. Ask ASPIn: "What secret are you using? Has it been rotated recently?"

- 400 Bad Request → Payload schema mismatch. Compare the payload of a successful vs failed webhook.

- 409 Conflict → Idempotency duplicate. Check if the same transaction_id was processed twice.

- 429 Too Many Requests → Rate limiting. Check X-RateLimit-\* headers.

- 500 Internal Server Error → Application bug. Request stack traces.

**Validate signature implementation** —

```javascript
// Reproduction script
const crypto = require("crypto");

function verifySignature(payload, signature, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Test with a known successful webhook vs failed webhook.

**_ Check idempotency store_** —

```sql

-- Query idempotency records for the 7 transaction IDs
SELECT * FROM idempotency_keys
WHERE key IN ('TXN_123456', 'TXN_234567', ...)
ORDER BY created_at DESC;

```

If records exist with created_at before the webhook was sent → False positive duplicate detection.

#### Phase 3: Deep Dive

**Replay one failed webhook** —

    - Ask PaymentHub to manually redeliver one of the 7 webhooks

    - Watch the entire chain with debug logging enabled

    - Capture request/response at every hop

**Review recent changes** —

    - Ask ASPIn: "What changed in the last 24 hours?" (code, config, infrastructure)

    - Check version control history for webhook handler changes

    - Review feature flag toggles

**Load test** — If rate limiting is suspected, check if the 8 successful webhooks were spread out and the 7 failed ones were clustered in a short window.

### 5. Propose a solution and prevention strategy

#### Immediate Fix (Unblock Customers):

**Manual webhook replay** — Ask PaymentHub to redeliver webhooks for the 7 transactions.

**Manual payment reconciliation** — If replay is not possible, use ASPIn's Admin Portal or API to manually record payments:

```json

POST /api/payments?partner=demo
{
"policy_guid": "5488c615ed6543e3a1f2edf160dd13f0",
"amount_in_cents": 500000,
"mno_reference": "MANUAL_20260212_001",
"status": "Succeeded",
"channel": "AdminPortal",
"effected_at": "2026-02-11"
}

```

**Temporary bypass** — If signature validation is failing:

- Option A: ASPIn temporarily disables signature validation (with logging) to unblock

- Option B: PaymentHub temporarily uses old secret while rotation is fixed

#### Medium-term Solution (Systemic Fix):

If the issue is Webhook URL misconfiguration:

**Centralized webhook configuration service** —

```yaml
# Single source of truth

webhooks:
aspin:
url: https://api.aspin.com/v1/webhooks/payment
environment: production
last_verified: 2026-02-12T10:00:00Z
verified_by: ci-cd-pipeline
```

**Automated URL verification on update** —

- Send test webhook to new URL before saving configuration

- Require 200 OK response to confirm reachability

**Webhook URL health monitoring** —

```promql

# Alert if webhook endpoint returns non-2xx for >5 minutes

probe_success{job="webhook_endpoint"} == 0

```

If the issue is Signature validation failures:

**Implement secret rotation with overlap period** —

```javascript
// Accept both old and new secrets during rotation window
function verifySignature(payload, signature) {
  const secrets = [currentSecret, previousSecret];
  return secrets.some((secret) => {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  });
}
```

**Add signature metadata** —

```json
{
  "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
  "signature": "sha256=abc123...",
  "signature_version": 2,
  "timestamp": "2026-02-12T10:35:00Z"
}
```

**Monitor signature failures** —

```promql

# Alert on >1% signature validation failures

sum(rate(webhook_signature_failed_total[5m])) /
sum(rate(webhook_requests_total[5m])) \* 100 > 1

```

If the issue is Idempotency false positives:

**Use transaction_id as idempotency key** — Not a generated timestamp or random string.

**Extend idempotency window** — Payments may have weekend delays; store keys for 7 days not 24 hours.

**Return detailed 409 response** —

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "Duplicate webhook received",
    "details": {
      "original_transaction_id": "TXN_123456",
      "original_processed_at": "2026-02-11T10:35:00Z",
      "status": "completed"
    }
  }
}
```

If the issue is Payload schema mismatch:

**Version your webhook payloads** —

```json

{
"api_version": "v2",
"data": { ... }
}

```

**Support multiple versions during migration** — Continue accepting v1 payloads for 30 days after v2 release.

**Schema validation with detailed errors** —

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "field": "amount_in_cents",
        "issue": "Required field missing",
        "documentation": "https://docs.paymenthub.com/webhooks/v2#amount_in_cents"
      }
    ]
  }
}
```

If the issue is Network/firewall:

**Publish static IP ranges** —

```yaml
# In documentation

webhook_sender_ips:
  - 203.0.113.0/24
  - 198.51.100.0/24
```

**Implement dead letter queue (DLQ)** —

- Failed webhooks go to SQS/RabbitMQ

- Manual replay UI for support engineers

- Automatic replay with exponential backoff

**Webhook delivery receipts** —

- Respond with 202 Accepted immediately

- Process webhook asynchronously

- Send delivery receipt via separate channel if needed

#### Long-term Prevention:

**Synthetic transaction monitoring** —

```javascript
// Every hour, create a test payment and verify webhook delivery
async function testWebhookDelivery() {
  const testPayment = await createTestPayment(1); // KES 1
  await waitForWebhook(testPayment.id, 30000); // 30s timeout
  assert(webhookReceived && webhook.status === "completed");
}
```

**Webhook inspector dashboard** —

```text
Features:

- Real-time webhook stream
- Filter by transaction ID, status, date
- Replay button for failed deliveries
- Payload viewer with schema validation
- Response timeline

```

**Service Level Objectives (SLOs)** —

```text

99.9% of webhooks delivered within 30 seconds
99.99% of webhooks delivered within 5 minutes
<0.1% false positive idempotency rate

```

**Post-mortem template** —

```markdown
## Webhook Delivery Failure Post-Mortem

**Incident ID:** INC-2026-02-12-001
**Date:** 2026-02-12
**Impact:** 7/15 (47%) webhooks failed to activate policies

### Timeline

- 10:35: First failed webhook
- 11:20: Customer support ticket created
- 11:45: Engineering alerted
- 12:30: Root cause identified
- 13:15: Fix deployed

### Root Cause

[Detailed explanation]

### Action Items

| Action                                 | Owner        | Due Date   |
| -------------------------------------- | ------------ | ---------- |
| Implement webhook signature versioning | Backend Team | 2026-02-19 |
| Add monitoring for signature failures  | DevOps       | 2026-02-16 |
| Update runbook with replay procedure   | Support Team | 2026-02-15 |

### Prevention

How we prevent this from happening again
```

My Conclusion: Both bugs highlight the same lesson: In financial services integrations, reliability is not optional. Idempotency, retries with exponential backoff, comprehensive logging, and proactive monitoring are not "nice to have" — they are minimum requirements for production systems.
