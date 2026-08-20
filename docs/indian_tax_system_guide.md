# Comprehensive Guide to the Indian Tax System

This document is designed to give you a foundational understanding of the Indian taxation system, focusing on the current rules for **Financial Year (FY) 2026-27 (Assessment Year 2027-28)**. Since you are building a tax calculation service (RAG-based), this guide breaks down the rules into clear, programmable logic and concepts.

---

## 1. The Broad Classification: Direct vs. Indirect Taxes

The Indian tax system is broadly divided into two categories:

*   **Direct Taxes:** Taxes levied directly on the income or wealth of individuals and corporations. The burden cannot be shifted to someone else.
    *   *Examples:* Income Tax, Corporate Tax, Capital Gains Tax.
*   **Indirect Taxes:** Taxes levied on the consumption of goods and services. The final consumer pays this, but it is collected by the seller/provider.
    *   *Examples:* Goods and Services Tax (GST), Customs Duty.

---

## 2. Income Tax (For Individuals)

Income tax in India is progressive, meaning higher income attracts a higher tax rate. Currently, there are two distinct systems (regimes). **For FY 2026-27, the New Tax Regime is the default.**

### A. The New Tax Regime (Default)
Designed for simplicity, this regime offers lower tax rates but **removes most traditional deductions and exemptions** (like Section 80C, HRA, etc.).

**Slab Rates:**
*   Up to ₹4,00,000: **Nil**
*   ₹4,00,001 to ₹8,00,000: **5%**
*   ₹8,00,001 to ₹12,00,000: **10%**
*   ₹12,00,001 to ₹16,00,000: **15%**
*   ₹16,00,001 to ₹20,00,000: **20%**
*   ₹20,00,001 to ₹24,00,000: **25%**
*   Above ₹24,00,000: **30%**

**Key Features (New Regime):**
*   **Standard Deduction:** A flat ₹75,000 deduction is available for salaried individuals and pensioners.
*   **Tax Rebate (Section 87A):** If the net taxable income is up to ₹12,00,000, a rebate is provided making the effective tax **zero**.

### B. The Old Tax Regime (Optional)
This regime has higher tax rates but allows taxpayers to claim various exemptions and deductions to lower their taxable income.

**Slab Rates (for individuals below 60 years):**
*   Up to ₹2,50,000: **Nil**
*   ₹2,50,001 to ₹5,00,000: **5%**
*   ₹5,00,001 to ₹10,00,000: **20%**
*   Above ₹10,00,000: **30%**

**Key Features (Old Regime):**
*   **Standard Deduction:** A flat ₹50,000 deduction.
*   **Deductions Available:** Taxpayers can claim deductions under Section 80C (up to ₹1.5L for life insurance, PPF, ELSS), Section 80D (health insurance), HRA (House Rent Allowance), and interest on home loans.

> [!TIP]
> **Implementation Note for your RAG System:** Your system should require the user to explicitly select whether they are opting for the Old or New regime, as the calculation paths are entirely different. If no input is provided, default to the New Regime.

---

## 3. Capital Gains Tax

This tax applies to the profit made from selling a "capital asset" (like stocks, mutual funds, real estate, gold).

*   **Short-Term Capital Gains (STCG):** Applies to assets held for a short period (varies by asset type, e.g., < 1 year for stocks). Taxed at applicable slab rates or specific STCG rates (e.g., 15% or 20% for certain equities).
*   **Long-Term Capital Gains (LTCG):** For FY 2026-27, the taxation has been streamlined. Generally, LTCG is taxed at **12.5%**.
*   **Indexation:** For older real estate properties, individuals can sometimes adjust the purchase price for inflation using the Cost Inflation Index (CII) before calculating the profit.

---

## 4. Corporate Tax

Taxes levied on the net income or profit of corporations from their businesses.

*   **Domestic Companies:**
    *   Standard Rate: **30%**
    *   Companies with turnover up to ₹400 Crore (in the specified previous year): **25%**
    *   Concessional rates (under sections 115BAA/115BAB): **22%** or **15%** (specifically for new manufacturing companies).
*   **Foreign Companies:** Generally taxed at **35%**.

*(Note: Surcharges and Health & Education Cess apply on top of these base rates).*

---

## 5. Goods and Services Tax (GST)

GST is an indirect tax used in India on the supply of goods and services. It is a comprehensive, multi-stage, destination-based tax.

**GST Components:**
*   **CGST (Central GST):** Collected by the Central Government on an intra-state sale.
*   **SGST (State GST):** Collected by the State Government on an intra-state sale.
*   **IGST (Integrated GST):** Collected by the Central Government for inter-state sales.

**GST Slabs (GST 2.0 structure):**
*   **0%:** Essential goods (e.g., unpackaged food grains, fresh vegetables).
*   **5%:** Mass consumption items (e.g., packaged food, transport services).
*   **12% & 18%:** Standard rates for most goods and services (e.g., electronics, IT services, eating out). 18% is the most common slab.
*   **28% (and higher with cess):** Luxury goods and "sin" goods (e.g., luxury cars, tobacco).

---

## 6. Key Terminology for your RAG Database

When generating vectors or populating your `tax_rules_seed.json`, ensure the AI understands these terms:

*   **Gross Total Income:** Total income from all sources (Salary, House Property, Business, Capital Gains, Other Sources) before any deductions.
*   **Net Taxable Income:** Gross Income minus all eligible deductions. This is the figure on which the tax slab percentages are applied.
*   **Financial Year (FY):** The year in which the income is earned (e.g., 1st April 2026 to 31st March 2027).
*   **Assessment Year (AY):** The year in which the income earned in the FY is evaluated and taxed (e.g., AY 2027-28 is for FY 2026-27).
*   **TDS (Tax Deducted at Source):** Tax automatically deducted by the employer or payer before handing the money to the payee.
*   **Cess:** An additional 4% "Health and Education Cess" is added to the final calculated income tax amount.

---

## Next Steps for your RAG Service

1.  **Seed Data Structure:** Ensure your vector database has distinct documents for "New Regime Slabs", "Old Regime Slabs", "Deductions (80C, 80D)", and "Capital Gains 12.5% rule".
2.  **Context Retrieval:** When a user asks "How much tax do I pay on a 15L salary?", the RAG should retrieve the **New Regime** document as the default context to answer accurately.
