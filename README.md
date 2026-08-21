# GigLedger Backend 🚀

> **Agentic Tax & Income Manager for Gig Workers**
> Built with Node.js, Express, MongoDB, and Gemini LLM. Featuring RAG-powered tax computation, automated tracking agents, and a secure human-in-the-loop inbox design.

---

## 🌟 Key Features

* **Passwordless OTP Auth:** Safe and frictionless email-based OTP sign-in / signup flow. No passwords stored or managed.
* **Agentic Categorization Engine:** Scans raw transaction strings (e.g., from Uber/Swiggy payouts) and runs them through a planner to produce proposed categories without modifying real ledger data until approved.
* **Human-in-the-loop Approval & Audit Log:** Every action recommended by the AI is staged in an `AgentTask` proposal queue. An immutable `AuditLog` records every user decision.
* **RAG-Powered Tax Estimations:** Retrieves real fiscal tax code documents from a Vector Database (Pinecone) to build contextually accurate estimations based on current rules and CITations, doing math deterministically in code instead of LLM arithmetic.
* **Proactive Deadline Monitoring:** A dedicated background agent synchronizes upcoming statutory advance-tax dates and drops warning suggestions inside the task inbox.
* **Multimodal Receipt OCR (Bonus):** Scan and upload photos of receipt sheets. The Vision LLM extracts transactions, maps them to expense fields, and prompts the user for verification.

---

## 🛠️ Technology Stack

* **Core:** Node.js, Express
* **Database:** MongoDB (Mongoose), Pinecone (Vector database for tax rules)
* **LLM Engine:** Google Gemini API (`gemini-flash-lite-latest` / `gemini-pro`)
* **Security:** Helmet, CORS protection, custom JWT Verification, express-rate-limit
* **Logging:** Winston
* **Testing & Tools:** Postman collections, manual seeding scripts, custom CI workflows

---

## 📁 Directory Structure

```text
gigledger-backend/
├── docs/                 # Detailed API references & specs
├── plans/                # Feature development plans (gitignored)
├── postmans/             # Postman test files (gitignored)
├── src/
│   ├── config/           # DB, Gemini, and Mailer client configurations
│   ├── constants/        # Fixed rules (like statutory calendar dates)
│   ├── controllers/      # Express route controllers
│   ├── middleware/       # JWT auth, validation parser, error handling
│   ├── models/           # Mongoose Schemas (User, Transaction, AgentTask, etc.)
│   ├── routes/           # API routes definitions
│   ├── services/         # Orchestrator agent services & RAG queries
│   └── utils/            # Winston logger, Async Handler, and tax math
├── server.js             # Entry point
└── app.js                # App configuration
```

---

## 🚀 Getting Started

### 1. Prerequisite Environment Setup
Clone the repository and copy the environment template to your local environment file:
```bash
cp .env.example .env
```
Open `.env` and configure your credentials:
* `MONGO_URI`: Your MongoDB Atlas cluster connection string.
* `JWT_SECRET`: Any random string for signing JWT tokens.
* `GEMINI_API_KEY`: Your Google AI Studio Gemini developer API key.
* `PINECONE_API_KEY`: Pinecone API token for tax document queries.

### 2. Install Dependencies
```bash
npm install
```

### 3. Seed Database
Initialize category master lists and generate realistic pending transactions for the demo user:
```bash
npm run seed
```

### 4. Run Locally
Start the local server in development mode (watches for file changes):
```bash
npm run dev
```
The server will boot up and start listening on port `5000` (by default):
```text
info: MongoDB connected
info: GigLedger API listening on port 5000
```

---

## 🧪 Testing the API

To quickly interact with and test the application, a pre-configured Postman collection is available inside the codebase:

1. Import the file located at: `postmans/GigLedger-All.postman_collection.json`.
2. Send the **Register** or **Login** request. 
3. Check your server terminal window where the backend is running; since SMTP is mock-configured in local dev, **the OTP code will print directly in your console logs**.
4. Pass the OTP to the **Verify** request. This automatically populates the `{{token}}` variable at the collection level, granting access to every other protected endpoint.

---

## 🔒 Security & Reliability Guarantees

> [!IMPORTANT]
> * **Append-Only Auditing:** The `AuditLog` collection enforces an append-only structure. Any update or delete queries targeted at `AuditLog` will throw errors at the mongoose-hook level to prevent editing history records.
> * **Rate Limits on Generative Actions:** Calls to LLM endpoints (`/api/tax/estimate` and `/api/receipts/upload`) are rate-limited to `5 requests per minute` per authenticated user to prevent API billing runs and API throttling.
