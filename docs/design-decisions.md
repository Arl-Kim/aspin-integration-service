# API Design Decisions - PartnerCRM KYC Integration

## 1. Why REST?

Why RESTful API is preffered over alternatives like GraphQL, gRPC, or SOAP.

**Rationale:**

- **Universality:** REST is the industry standard for public APIs. Partners are familiar with it.
- **Simplicity:** HTTP semantics are well-understood; minimal learning curve.
- **Tooling:** Excellent ecosystem (OpenAPI, Postman).
- **Stateless:** Scales horizontally without session affinity.
- **Cacheable:** Response caching at CDN/proxy level possible.
- **Given our partners include mobile network operators and banks in emerging markets, REST provides the widest compatibility across different technology stacks.**

---

## 2. Why The Status Codes ?

### 202 Accepted (Not 200 OK)

I decided to return 202 for verification requests, not 200.

This decision was motivated by the fact that KYC verification is **asynchronous**. It may take seconds to minutes (or hours for manual review). 202 clearly signals: "We received your request and are processing it, but the result isn't ready yet." This prevents partners from polling immediately and encountering 404 errors.

### 409 Conflict for Idempotency

I decided to use 409 when idempotency key is reused with different request body.

The main reason is HTTP semantics i.e. 409 indicates a conflict with the current state of the resource. If a partner accidentally reuses an idempotency key with different customer data, it's a conflict that requires manual intervention not a validation error (400) or success (200).

### 429 Too Many Requests

I also decided to include rate limiting headers with 429 responses.

This will prevent abuse and ensures fair usage. I think it is essential for a platform serving multiple large partners (telcos, banks). Then headers allow clients to implement intelligent backoff.

---

## 3. Idempotency Implementation

Another design decision was to support idempotency via:

1. `idempotency_key` field in request body
2. `Idempotency-Key` header alternative
3. Webhook deliveries include unique `event_id`

**My Reasons**

- Network failures cause retries; without idempotency, partners create duplicate customer records
- 24-hour window balances safety with storage costs
- UUID v4 ensures global uniqueness without coordination

---

## 4. Webhook Design

**Design Decision:**

- Signed payloads (HMAC-SHA256)
- Idempotency via `event_id`
- Retry with exponential backoff
- Webhook registration endpoint with secret management

**My Reasons**

- **Signatures:** Prove webhooks came from PartnerCRM, not attackers
- **Idempotency:** Partners may receive the same webhook twice; they need to detect duplicates
- **Retries:** Networks fail; we guarantee at-least-once delivery

---

## 5. Error Response Format

I decided to have a consistent error object with:

- Machine-readable error code
- Human-readable message
- Detailed field validation array
- Trace ID for debugging

**My Reasons**

- **Error codes:** Allow partners to automate handling (e.g., retry on 500, fix validation on 400)
- **Field details:** Frontend developers can map errors directly to form fields
- **Trace ID:** Fellow Support Engineers can correlate partner reports with internal logs

**Example scenario:** Partner calls support: "Request failed with trace_id trace_abc123". Engineer immediately finds the exact request and error.

---

## 6. HATEOAS Links

I decided to include `_links` object in responses with self/status URLs.

**My Reasons**

- Reduces partner development effort
- Self-documenting API
- Follows REST maturity level 3
- Partners don't need to construct URLs manually

---

## 7. ISO Standards Compliance

I also decided to use ISO standards throughout:

- `country`: ISO 3166-1 alpha-2 (KE, UG, TZ, etc.)
- `date_of_birth`: ISO 8601 (YYYY-MM-DD)
- `timestamps`: ISO 8601 with Zulu time (2026-02-11T10:30:00Z)
- `phone_number`: E.164 (+254712345678)

**My Reason** Operating across African markets requires consistent formats. ISO standards eliminate ambiguity and parsing errors.

---

## 8. Security Considerations

**Implemented:**

- API keys transmitted via header, never URL
- Webhook signatures prevent tampering
- HTTPS required for all endpoints
- Rate limiting prevents abuse

---

## 9. Alignment with ASPIn Production API Patterns

This API specification is designed to mirror the patterns observed in ASPIn's actual production APIs:

### Asynchronous Processing Pattern

ASPIn uses 200 OK with immediate response for registrations (not 202). My PartnerCRM spec uses 202 Accepted. I decided to maintain 202 for PartnerCRM as it's truly async but keeping in mind that our Payment Integration Service must handle ASPIn's synchronous expectations.

### Identifier Standards

- **GUIDs:** ASPIn uses 32-character hex UUIDs without hyphens (e.g., "5488c615ed6543e3a1f2edf160dd13f0")
- **MSISDN:** E.164 format with leading "00" (e.g., "00271603773356") not "+"
- **Amounts:** Always in cents as integers
- **Dates:** ISO 8601 without time (YYYY-MM-DD) for `effected_at`

### Idempotency Implementation

ASPIn enforces uniqueness on `mno_reference`. This aligns with my idempotency design for webhooks.

### Partner Context

Every request requires `partner=demo` query parameter. My design includes `partner_guid` in schemas
to accommodate this requirement when the service calls ASPIn.

---

## Summary

This API design prioritizes:

1. **Partner Developer Experience** - Clear docs, predictable behavior, idempotency
2. **Reliability** - Async processing, webhooks with retries
3. **Debuggability** - Trace IDs, structured errors, consistent formats
4. **Production Readiness** - Rate limiting, authentication, security signatures
