namespace Artha.Core.Models;

/// <summary>
/// A predefined recurring expense used for planning/budgeting only (e.g. Rent,
/// Broadband, Insurance). It is NOT a transaction — it never creates an
/// <see cref="Expense"/>. <see cref="Amount"/> is the figure per billing
/// <see cref="Cycle"/> ("monthly" or "yearly"); reports normalise a yearly
/// figure to a monthly one (Amount / 12) when comparing against actual spend.
/// </summary>
public sealed record PlannedExpense(
    string Id,
    string Name,
    decimal Amount,
    string? CategoryId,
    int? DayOfMonth,
    bool Archived,
    // Billing cycle; trailing optional so existing stored items default to monthly.
    string Cycle = "monthly");
