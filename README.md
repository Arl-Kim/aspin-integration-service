# ASPIn Integration Service

A Node.js/TypeScript integration service that bridges the ASPIn core insurance platform with third-party partners including PartnerCRM (KYC), PaymentHub (payment processing), and NotifyService (communications) for customer onboarding, payments, and notifications respectively.

This project was developed as part of my Support Engineer role application technical assessment at Inclusivity Solutions and demonstrates API design, system integration, error handling, monitoring strategy, and troubleshooting workflows.

---

## Project Overview

This service acts as a middleware layer between:

- **ASPIn Core Platform**
- **PartnerCRM** (KYC & Registration)
- **PaymentHub** (Airtel & M-Pesa)
- **NotifyService** (SMS/Email)

Key responsibilities include:

- **Customer Registration & KYC** - API specifications for PartnerCRM integration
- **Payment Collection** - Node.js/TypeScript service for M-Pesa & Airtel Money payments
- **Incident Response** - Structured debugging approach for real-world integration issues
- **Observability** - Comprehensive monitoring and alerting strategy

---

## Tech Stack & Key Design Decisions

### Technology Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript 5.x
- **Framework:** Express.js 4.x
- **HTTP Client:** Axios 1.x
- **Environment Management:** dotenv
- **Schema Validation**: Zod
- **Testing:** (Planned) Jest + Supertest
- **Logging & Monitoring:** Console / Sentry (Simulated)
- **API Documentation**: OpenAPI 3.0 (YAML)

### Key Design Decisions

- **TypeScript** for type safety and maintainability
- **Express.js** for lightweight API development
- **Modular Architecture** (controllers, services, routes)
- **RESTful APIs** for interoperability
- **Schema Validation**: Zod (runtime type safety)
- **Webhook Signature Validation** for security (HMAC-SHA256 verification)
- **Idempotency Handling** to prevent duplicate processing

---

## Setup Instructions

1. Clone this repository

   ```bash

   git clone https://github.com/Arl-Kim/aspin-integration-service.git

   cd aspin-integration-service

   ```

2. Navigate to `src/` and run `npm install`

   ```bash

   cd src

   npm install

   ```

3. Set up environment variables: Create a .env file in the src directory and include the following:

   /src/.env

   ```env

   NODE_ENV=development
   PORT=3000
   API_KEY=your_test_api_key
   WEBHOOK_SECRET=your_webhook_secret
   PAYMENT_HUB_API_URL=http://localhost:3001
   PAYMENT_HUB_TIMEOUT=5000
   ASPIN_CALLBACK_URL=http://localhost:3000/api/payments/webhook
   ASPIN_API_URL=https://engine.staging.aspin-inclusivity.com
   ASPIN_CLIENT_ID=5BNGscbCVZ
   ASPIN_CLIENT_SECRET=XK0inXBj1KZ8Eo98ugnTmuZUfDOenIeV
   ASPIN_USERNAME=test_admin
   ASPIN_PASSWORD=Qwertyui1!
   ASPIN_PARTNER_GUID=demo
   ASPIN_TOKEN_URL=${ASPIN_API_URL}/oauth/token
   ASPIN_PAYMENT_URL=${ASPIN_API_URL}/api/payments
   IDEMPOTENCY_TTL=86400
   LOG_LEVEL=debug

   ```

4. Run `npm run dev` to start the development server

### Production Build

```bash

npm run build

npm start

```

### Running Tests

```bash

# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- payments.service.spec.ts

```

---

## Security Considerations

- All endpoints require API key authentication (simulated)
- Webhook signatures verified using HMAC-SHA256
- Input validation on all public endpoints
- Rate limiting recommended for production
- No sensitive data in logs

---

## Documentation & Assessment Parts

- API specifications are located in /docs
- Written troubleshooting and monitoring answers are in /answers

1. API Design & Documentation - See `/docs/api-spec.yaml` and `/docs/design-decisions.md`
2. Integration Implementation - See `/src/`
3. Debugging & Troubleshooting - See `/answers/part3-debugging.md`
4. Monitoring & Observability - See `/answers/part4-monitoring.md`

---

## Dev Scripts (package.json)

Open `package.json`

Replace your `"scripts"` section with:

```json

"scripts": {
    "dev": "nodemon --exec ts-node server.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write \"**/*.{ts,json,md}\"",
    "clean": "rm -rf dist"
  }

```

You'll need to install the dev dependencies for these scripts:

```bash

cd src

npm install --save-dev nodemon jest @types/jest ts-jest eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier

```

---

## Author

**Name** - Allan Kimutai Tum

**Email** - allankimutaitum@gmail.com

**Website** - https://allankimutai.dev
