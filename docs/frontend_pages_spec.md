# Frontend Pages — Gig Worker Tax Management App

**Stack:** React Native (Mobile App)  
**Backend:** Express + MongoDB + Gemini RAG  
**Target Users:** Freelancers, Cab/Delivery Drivers, Gig Workers in India

---

## Summary — All Pages at a Glance

| # | Page Name | Route | Purpose |
|---|---|---|---|
| 1 | Splash / Onboarding | `/` | First launch, app intro |
| 2 | Worker Type Selection | `/onboarding/type` | Choose: Freelancer / Driver / Delivery |
| 3 | Dashboard (Home) | `/dashboard` | Overview of income, tax health |
| 4 | Income Entry | `/income/add` | Log a payment received |
| 5 | Expense Entry | `/expense/add` | Log a business expense |
| 6 | Tax Estimate (RAG) | `/tax/estimate` | AI-powered tax calculation + citations |
| 7 | Tax Savings Tips | `/tax/savings` | Suggestions from RAG: missed deductions, presumptive tax |
| 8 | Tax Rules Explorer | `/rules` | Browse the tax rule knowledge base |
| 9 | Upcoming Deadlines | `/deadlines` | TDS, Advance Tax, ITR filing dates |
| 10 | Profile & Settings | `/settings` | Worker type, PAN, preferences |

---

## Page 1 — Splash / Onboarding Screen

**When shown:** Only on first launch or when the user has not completed onboarding.

### Content:
- **App Logo & Name** — e.g., "GigTax AI"
- **Tagline** — "Smart tax management for India's gig workers"
- 3 swipeable intro slides:
  - Slide 1: "Know exactly how much tax you owe — powered by AI"
  - Slide 2: "Log income and expenses in seconds"
  - Slide 3: "Get personalized tax saving tips grounded in real Indian law"
- **CTA Button:** "Get Started"

---

## Page 2 — Worker Type Selection

**When shown:** After onboarding, before the dashboard. Stored in user profile/local storage.

### Content:
- Heading: "What kind of gig work do you do?"
- 3 large tappable cards:

| Card | Label | Icon | `workerType` value sent to backend |
|---|---|---|---|
| A | Freelancer / Consultant | 💻 | `freelancer` |
| B | Cab / Ride-Hailing Driver | 🚗 | `ride_hailing_and_delivery` |
| C | Delivery Partner | 📦 | `ride_hailing_and_delivery` |

- Small note: "This helps us find the right tax rules for you"
- **CTA Button:** "Continue"

> This selection maps directly to the `workerType` parameter sent to `POST /api/tax/estimate`.

---

## Page 3 — Dashboard (Home)

**The main screen users land on every day.**

### Content Sections:

#### A. Tax Health Summary Card (Top)
A prominent card showing:
```
FY 2026-27                              🟢 On Track
Estimated Tax Due:        ₹14,700
Total Earned (YTD):       ₹3,50,000
Total Deductions:         ₹72,000
Monthly Set-Aside:        ₹1,225 / month
```

#### B. Quick Actions Row
4 icon buttons:
- ➕ Log Income
- 🧾 Log Expense
- 🧮 Calculate Tax
- 💡 Get Savings Tips

#### C. Recent Transactions (Mini Feed)
Last 5 income/expense entries:
```
✅ Uber Earnings        +₹12,500     Aug 18
🧾 Petrol - HPCL       -₹3,200      Aug 17
✅ Ola Earnings         +₹9,800      Aug 16
```

#### D. Upcoming Deadline Alert (if within 30 days)
```
⚠️  Advance Tax Due: March 15, 2027
    Single installment for presumptive taxpayers
```

---

## Page 4 — Income Entry Screen

**Route:** `/income/add`  
**Purpose:** Let the user log money they received from gig platforms.

### Form Fields:
| Field | Type | Example |
|---|---|---|
| Amount Received | Number Input | `₹12,500` |
| Source / Platform | Dropdown | Uber, Ola, Fiverr, Swiggy, Upwork, Other |
| Date Received | Date Picker | Aug 18, 2026 |
| Payment Method | Toggle | Bank Transfer / Cash / UPI |
| Notes (optional) | Text | "Aug 2nd week rides" |

### After Submit:
- Updates YTD earnings on dashboard.
- Shows: "Income logged! Your updated estimated tax: ₹X,XXX"

---

## Page 5 — Expense Entry Screen

**Route:** `/expense/add`  
**Purpose:** Log a business expense that may be tax-deductible.

### Form Fields:
| Field | Type | Example |
|---|---|---|
| Amount Spent | Number Input | `₹3,200` |
| Expense Category | Dropdown | See below |
| Description | Text | "HPCL Petrol for Uber Rides" |
| Date | Date Picker | Aug 17, 2026 |
| Receipt Uploaded? | Toggle/Camera | Yes / No |

**Expense Category Dropdown Options** (mapped to seed data):
- ⛽ Fuel / Petrol / Diesel
- 🔧 Vehicle Maintenance & Repair
- 📱 Mobile Recharge / Internet Bill
- 💻 Software / SaaS Subscriptions
- 🏢 Coworking Space / Office Rent
- 📉 Depreciation (Laptop / Vehicle)
- 👷 Subcontractor Payments
- 🏥 Health Insurance (80D)
- 💰 Investments (PPF / ELSS / LIC)
- 📦 Other Business Expense

> The description entered here becomes the `expenses[].description` sent to the RAG backend, which is used to retrieve the most relevant tax rules via vector search.

---

## Page 6 — Tax Estimate Screen (RAG-Powered)

**Route:** `/tax/estimate`  
**This is the flagship feature — the AI tax calculator.**

### Input Section (Pre-filled from dashboard data):
- Total Gross Earnings: ₹X,XX,XXX (auto-filled from logged income)
- Expenses: Listed from expense log (user can deselect any)
- Worker Type: Auto-filled from profile (editable)
- **"Calculate My Tax" button**

### Loading State:
- Animated spinner with text: "Retrieving relevant tax rules... Calculating..."

---

### Output Section (After API response):

#### A. Tax Summary Card
```
┌──────────────────────────────────────────────┐
│  Your Tax Estimate (New Regime, FY 2026-27)  │
│                                              │
│  Gross Earnings         ₹7,50,000           │
│  Total Deductions       ₹72,000             │
│  Net Taxable Income     ₹6,78,000           │
│  ─────────────────────────────────────────  │
│  Estimated Tax Due      ₹14,700             │
│                                              │
│  💰 Save ₹1,225/month to cover this         │
└──────────────────────────────────────────────┘
```

#### B. Applied Deductions Table
A scrollable list showing:
```
Expense               Claimed     Rule Applied
──────────────────────────────────────────────
Fuel Receipts        ₹45,000    Sec 37 Fuel  ↗
Internet Bill        ₹15,000    Sec 37 Mobile ↗
Car Servicing        ₹12,000    Sec 37 Maint. ↗
```
Each row has a **"↗ View Rule"** link that opens the official `source_url` in the browser.

#### C. AI Citations Panel
```
📚 Tax Rules Used (Retrieved by AI)
──────────────────────────────────────────────
[Rule 1] rule_vehicle_fuel_expense_section37
    Score: 0.88 | Section 37
    Fuel Expenses Deduction for Ride-Hailing...

[Rule 2] rule_mobile_internet_cab_driver_section37
    Score: 0.81 | Section 37
    Mobile Recharge & Internet for App Usage...
```
This builds trust — user sees the AI isn't hallucinating.

---

## Page 7 — Tax Savings Tips Screen

**Route:** `/tax/savings`  
**Source:** `taxSavingsSuggestions[]` from the RAG API response.

### Content:

#### Header
"💡 Ways to Save More Tax"  
Sub: "Based on your income & expenses, our AI found these opportunities:"

#### Suggestion Cards

Each card is styled by type:

**🟡 MISSING_DEDUCTION card:**
```
╔══════════════════════════════════════════════╗
║ 🟡 Missed Deduction Opportunity              ║
║                                              ║
║  Claim Vehicle Depreciation (Sec 32)         ║
║  Potential Savings: ₹6,000                   ║
║                                              ║
║  You haven't claimed 30% annual WDV          ║
║  depreciation on your vehicle. As a cab      ║
║  driver, this is fully deductible.           ║
║                                              ║
║  Rule: rule_vehicle_depreciation_section32   ║
║  [View Official Rule ↗]                      ║
╚══════════════════════════════════════════════╝
```

**🟢 PRESUMPTIVE_TAX card:**
```
╔══════════════════════════════════════════════╗
║ 🟢 Tax Regime Opportunity                    ║
║                                              ║
║  Opt for Section 44AE Presumptive Tax        ║
║  Potential Savings: ₹12,000                  ║
║                                              ║
║  For commercial vehicle owners with up to    ║
║  10 vehicles, flat-rate deemed profit at     ║
║  ₹1,000/tonne/month could lower your bill.  ║
║  No books required. File ITR-4 (Sugam).      ║
║                                              ║
║  Rule: rule_44ae_presumptive_goods_carriage  ║
║  [View Official Rule ↗]                      ║
╚══════════════════════════════════════════════╝
```

#### Bottom CTA
"Recalculate Tax with These Applied" → takes user back to Tax Estimate screen with suggestions pre-applied.

---

## Page 8 — Tax Rules Explorer

**Route:** `/rules`  
**Purpose:** Let users browse, search, and learn about tax rules that apply to them.

### Content:
- Search bar: "Search tax rules..."
- Filter chips: `expense_deduction` · `income_tax_slab` · `gst_compliance` · `tds_credit` · `tax_filing`
- Scrollable list of all rules from the knowledge base:

Each rule card:
```
📜 Software Subscriptions & SaaS (Section 37)
   Category: Expense Deduction
   For: Freelancers
   "Adobe, Figma, AWS, GitHub subscriptions are 100% deductible..."
   [View Full Rule] [Official Source ↗]
```

> This page lets users self-educate and understand *why* certain deductions apply to them.

---

## Page 9 — Upcoming Deadlines

**Route:** `/deadlines`  
**Source:** `upcomingDeadlines[]` from the RAG API response, plus hardcoded annual calendar.

### Content:

#### Deadline Calendar (Timeline View)
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔴 15 Mar 2027   Advance Tax Payment Due
                   100% in single installment
                   (Sec 211, Presumptive Taxpayers)

  🟡 31 Jul 2027   ITR Filing Deadline
                   ITR-4 for Presumptive / ITR-3 for others

  🟡 31 Oct 2027   ITR with Tax Audit (if applicable)
                   Gross receipts > ₹50L → CA audit needed

  🟢 Throughout    GST Returns (if registered)
                   Monthly/Quarterly GSTR-1 & GSTR-3B
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- Each deadline has a "Set Reminder" button.
- Color coding: 🔴 < 30 days · 🟡 < 90 days · 🟢 > 90 days

---

## Page 10 — Profile & Settings

**Route:** `/settings`

### Sections:

#### A. My Profile
| Field | Value |
|---|---|
| Name | Ankur Asrani |
| PAN Number | ABCDE1234F (optional, for reference) |
| Worker Type | Freelancer (editable) |
| FY Selected | 2026-27 |

#### B. Tax Preferences
- Preferred Tax Regime: New Regime (default) — *toggle hidden since you decided to drop Old Regime*
- GST Registered: Yes / No toggle
- Annual Turnover Estimate: ₹X,XX,XXX

#### C. Notifications
- Toggle: Deadline Reminders
- Toggle: Monthly Tax Health Check
- Toggle: New Tax Rule Alerts

#### D. App Info
- About / Terms
- Data Privacy
- Clear Cache / Reset Data

---

## Navigation Structure (React Native Bottom Tab Bar)

```
┌────────┬────────┬────────┬────────┬────────┐
│  🏠    │  ➕    │  🧮    │  🔔    │  👤    │
│ Home   │ Log    │  Tax   │Deadlin │Profile │
│(Dash.) │(Income/│Estimate│  es    │       │
│        │Expense)│& Tips  │       │       │
└────────┴────────┴────────┴────────┴────────┘
```

The "Log" tab opens a modal letting the user pick "Income" or "Expense" before navigating to the respective form screen.

The "Tax" tab leads to Page 6 (Estimate), which links directly to Page 7 (Savings Tips).
