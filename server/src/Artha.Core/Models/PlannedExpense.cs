namespace Artha.Core.Models;

/// <summary>
/// A predefined recurring expense used for planning/budgeting only
/// (e.g. Rent monthly, Insurance yearly). It is NOT a transaction — it never
/// creates an <see cref="Expense"/>. Actual expenses can be linked back to a
/// planned expense (see <see cref="Expense.PlannedExpenseId"/>) to track which
/// bills have been paid. Reports compare the normalised monthly budget against
/// actual spending.
/// </summary>
public sealed record PlannedExpense(
    string Id,
    string Name,
    decimal Amount,
    // How often this expense recurs — see <see cref="PlannedExpenseFrequencies"/>.
    // May be null on documents written before the frequency field shipped;
    // callers treat null/blank as monthly.
    string? Frequency,
    string? CategoryId,
    int? DayOfMonth,
    bool Archived);

/// <summary>
/// Recurrence cadences for a <see cref="PlannedExpense"/>, plus the conversion
/// to a monthly-equivalent figure used for budgeting (a yearly bill counts as
/// amount/12 per month, etc.).
/// </summary>
public static class PlannedExpenseFrequencies
{
    public const string Weekly = "weekly";
    public const string Monthly = "monthly";
    public const string Quarterly = "quarterly";
    public const string Yearly = "yearly";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Weekly, Monthly, Quarterly, Yearly,
    };

    /// <summary>Null/blank/unrecognised cadences normalise to monthly.</summary>
    public static string Normalize(string? frequency)
    {
        if (string.IsNullOrWhiteSpace(frequency))
        {
            return Monthly;
        }
        var lower = frequency.Trim().ToLowerInvariant();
        return All.Contains(lower) ? lower : Monthly;
    }

    /// <summary>The amount expressed as a per-month figure for budget totals.</summary>
    public static decimal MonthlyEquivalent(decimal amount, string? frequency) => Normalize(frequency) switch
    {
        Weekly => amount * 52m / 12m,
        Quarterly => amount / 3m,
        Yearly => amount / 12m,
        _ => amount,
    };
}
