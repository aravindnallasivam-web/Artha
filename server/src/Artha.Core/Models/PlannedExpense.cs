namespace Artha.Core.Models;

/// <summary>
/// A predefined recurring monthly expense used for planning/budgeting only
/// (e.g. Rent, Broadband). It is NOT a transaction — it never creates an
/// <see cref="Expense"/>. The amount is a fixed monthly figure; reports compare
/// the sum of active planned expenses against actual spending for a month.
/// </summary>
public sealed record PlannedExpense(
    string Id,
    string Name,
    decimal Amount,
    string? CategoryId,
    int? DayOfMonth,
    bool Archived);
