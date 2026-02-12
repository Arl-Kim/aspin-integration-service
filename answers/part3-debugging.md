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
