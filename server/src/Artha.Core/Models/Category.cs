namespace Artha.Core.Models;

public sealed record Category(
    string Id,
    string Name,
    string? Color,
    string? Icon,
    bool Archived,
    // When true, this category's expenses are left out of report totals and
    // breakdowns (e.g. Investments, transfers to savings). Trailing optional
    // param so existing stored categories deserialize with the default (false).
    bool ExcludeFromReports = false);
