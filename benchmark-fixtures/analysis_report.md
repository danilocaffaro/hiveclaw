# Company Dataset Analysis Report

**Dataset:** `companies.json` — 200 companies across 5 sectors and 7 countries  
**Generated:** 2026-03-20  

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total Companies | 200 |
| Total Revenue | $4,899,889,551.50 |
| Average Revenue (all) | $24,499,447.76 |
| Min Revenue | $626,926.70 |
| Max Revenue | $49,933,886.48 |
| Avg Employees | 2,691 |

---

## 1. Average Revenue per Sector

Sectors ranked by average revenue, descending.

| Rank | Sector | Companies | Avg Revenue | Total Revenue |
|---:|---|---:|---:|---:|
| 1 | Retail | 45 | $26,785,184.21 | $1,205,333,289.65 |
| 2 | Finance | 44 | $25,006,784.88 | $1,100,298,534.78 |
| 3 | Health | 27 | $24,829,133.93 | $670,386,616.12 |
| 4 | Energy | 27 | $23,172,615.23 | $625,660,611.11 |
| 5 | Tech | 57 | $22,775,622.80 | $1,298,210,499.84 |

> **Key insight:** Retail leads in average revenue ($26.8M) despite Tech having the most companies (57) and highest total revenue ($1.30B). Tech's large count dilutes its per-company average.

---

## 2. Top 5 Companies by Revenue

| Rank | Company | Revenue | Sector | Country |
|---:|---|---:|---|---|
| 🥇 1 | Company_071 | $49,933,886.48 | Energy | BR |
| 🥈 2 | Company_060 | $49,794,257.09 | Energy | US |
| 🥉 3 | Company_082 | $49,382,261.10 | Health | IN |
| 4 | Company_097 | $49,323,070.98 | Energy | UK |
| 5 | Company_102 | $49,234,870.58 | Finance | UK |

> **Key insight:** 3 of the top 5 revenue earners are in the Energy sector. The top 5 are spread across 4 different countries (BR, US, IN, UK), showing no single-country dominance at the top.

---

## 3. Country with Most Companies

| Rank | Country | Company Count | Share |
|---:|---|---:|---:|
| 🏆 1 | Brazil (BR) | 34 | 17.0% |
| 2 | Germany (DE) | 31 | 15.5% |
| 3 | United Kingdom (UK) | 30 | 15.0% |
| 4 | France (FR) | 29 | 14.5% |
| 5 | India (IN) | 29 | 14.5% |
| 6 | Japan (JP) | 25 | 12.5% |
| 7 | United States (US) | 22 | 11.0% |

> **Key insight:** **Brazil (BR) has the most companies** with 34 (17% of the dataset). Distribution is relatively balanced — the gap between the highest (BR: 34) and lowest (US: 22) is only 12 companies, indicating no extreme geographic concentration.

---

## 4. Correlation — Employees vs. Revenue

Method: **Pearson correlation coefficient (r)**

| Statistic | Employees | Revenue |
|---|---:|---:|
| Mean | 2,691 | $24,499,447.76 |
| Std Dev | 1,366.72 | $13,590,328.08 |

| Metric | Value |
|---|---|
| Pearson r | **0.0356** |
| Strength | Very weak positive |
| Interpretation | Negligible linear relationship |

> **Key insight:** With **r ≈ 0.036**, there is virtually **no linear correlation** between the number of employees and revenue. Company size (headcount) is not a reliable predictor of revenue in this dataset — small companies can generate high revenue and vice versa. This suggests revenue is driven more by sector, business model, or other factors than by workforce size alone.

---

## Appendix — Methodology

- **Average revenue per sector:** arithmetic mean of `revenue` field grouped by `sector`.
- **Top 5 by revenue:** sorted descending by `revenue`, top 5 selected.
- **Country count:** frequency count of `country` field across all 200 records.
- **Pearson r:** computed as `cov(employees, revenue) / (σ_employees × σ_revenue)` using population statistics (N=200).
