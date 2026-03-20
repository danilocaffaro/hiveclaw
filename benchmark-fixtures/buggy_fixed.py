"""User manager module — all 3 bugs fixed."""
from __future__ import annotations  # enables PEP 604 `X | Y` hints on Python 3.9


def calculate_average(numbers: list[float]) -> float:
    """Bug 1 fixed: divide by len(numbers), not len(numbers) + 1."""
    total = sum(numbers)
    return total / len(numbers)          # was: len(numbers) + 1

def find_user(users: list[dict], name: str) -> dict | None:
    """Bug 2 fixed: compare user["name"], not user["email"]."""
    for user in users:
        if user.get("name") == name:     # was: user.get("email")
            return user
    return None

def format_report(items: list[str]) -> str:  # Bug 3 fixed: added missing colon
    """Bug 3 fixed: colon added after the function signature."""
    header = "=== Report ==="
    body = "\n".join(f"- {item}" for item in items)
    return f"{header}\n{body}"

if __name__ == "__main__":
    nums = [10, 20, 30]
    print(f"Average: {calculate_average(nums)}")  # Should be 20.0

    users = [{"name": "Alice", "email": "alice@test.com"}]
    print(f"Found: {find_user(users, 'Alice')}")  # Should find Alice

    print(format_report(["item1", "item2"]))
