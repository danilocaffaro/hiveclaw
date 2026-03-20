"""User manager module — has 3 intentional bugs."""

def calculate_average(numbers: list[float]) -> float:
    """Bug 1: off-by-one — divides by len+1 instead of len."""
    total = sum(numbers)
    return total / (len(numbers) + 1)

def find_user(users: list[dict], name: str) -> dict | None:
    """Bug 2: logic error — compares email instead of name."""
    for user in users:
        if user.get("email") == name:
            return user
    return None

def format_report(items: list[str]) -> str
    """Bug 3: syntax error — missing colon above."""
    header = "=== Report ==="
    body = "\n".join(f"- {item}" for item in items)
    return f"{header}\n{body}"

if __name__ == "__main__":
    nums = [10, 20, 30]
    print(f"Average: {calculate_average(nums)}")  # Should be 20.0

    users = [{"name": "Alice", "email": "alice@test.com"}]
    print(f"Found: {find_user(users, 'Alice')}")  # Should find Alice

    print(format_report(["item1", "item2"]))
