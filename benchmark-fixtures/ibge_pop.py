"""
ibge_pop.py
-----------
Fetches the population of the 10 largest Brazilian municipalities using the
IBGE SIDRA API (Table 9514 — 2022 Census, resident population by municipality).

Endpoint:
  https://apisidra.ibge.gov.br/values/t/9514/n6/all/v/93/p/2022
  - t/9514  → Table 9514: Censo Demográfico 2022 — population by municipality
  - n6/all  → All municipalities (territorial level 6)
  - v/93    → Variable 93: "População residente"
  - p/2022  → Year 2022 (only filter for "Total" across sex/age dimensions)

SIDRA API docs: https://apisidra.ibge.gov.br/home/ajuda
"""

import requests
import sys

API_URL = (
    "https://apisidra.ibge.gov.br/values"
    "/t/9514"   # Table: 2022 Census — Censo Demográfico
    "/n6/all"   # Level 6 = municipalities, all of them
    "/v/93"     # Variable 93: "População residente"
    "/p/2022"   # Period: 2022
    # No classification filters needed — the API returns the "Total" aggregate
    # row (sex=Total, age=Total, age-declaration=Total) by default.
)

TOP_N = 10


def fetch_population() -> list[dict]:
    """Fetch all-municipality population data from IBGE SIDRA and return
    a list of dicts with keys: code, name, population."""
    print(f"Fetching data from IBGE SIDRA API …")
    response = requests.get(API_URL, timeout=60)
    response.raise_for_status()
    raw = response.json()

    # First item is the header row — skip it
    records = raw[1:]

    results = []
    for rec in records:
        value = rec.get("V", "").strip()
        if not value or value == "-":
            continue
        try:
            pop = int(value.replace(".", "").replace(",", ""))
        except ValueError:
            continue
        results.append(
            {
                "code": rec["D1C"],
                "name": rec["D1N"],
                "population": pop,
            }
        )

    return results


def main():
    try:
        data = fetch_population()
    except requests.RequestException as exc:
        print(f"ERROR: Could not reach IBGE API — {exc}", file=sys.stderr)
        sys.exit(1)

    if not data:
        print("ERROR: No population data returned.", file=sys.stderr)
        sys.exit(1)

    # Sort descending and take top N
    top = sorted(data, key=lambda x: x["population"], reverse=True)[:TOP_N]

    print(f"\n{'Rank':<5} {'Municipality':<45} {'Population':>15}")
    print("-" * 67)
    for rank, mun in enumerate(top, start=1):
        pop_fmt = f"{mun['population']:,}".replace(",", ".")
        print(f"{rank:<5} {mun['name']:<45} {pop_fmt:>15}")

    print(f"\nSource : IBGE SIDRA — Table 9514 (Censo Demográfico 2022)")
    print(f"Total municipalities fetched: {len(data):,}")


if __name__ == "__main__":
    main()
