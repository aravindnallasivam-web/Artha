namespace Artha.Core.Models;

/// <summary>
/// A financial account the user spends from — checking, cash, credit card,
/// etc. Independent of Categories (which describe what an expense was for).
/// </summary>
public sealed record Account(
    string Id,
    string Name,
    string Type,
    string Currency,
    decimal OpeningBalance,
    string? Color,
    string? Icon,
    bool Archived,
    string? Bank = null);

public static class AccountTypes
{
    public const string Checking = "checking";
    public const string Savings = "savings";
    public const string Cash = "cash";
    public const string CreditCard = "credit_card";
    public const string Other = "other";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Checking, Savings, Cash, CreditCard, Other,
    };
}
