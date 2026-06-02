namespace Artha.Core.Models;

/// <summary>
/// An investment holding the user wants to track — a recurring/fixed deposit,
/// an insurance policy, or a mutual fund. A single record carries the union of
/// fields across all types; the type-irrelevant ones stay null (e.g. a mutual
/// fund has no <see cref="InterestRate"/>).
/// </summary>
public sealed record Investment(
    string Id,
    string Name,
    string Type,
    string Currency,
    decimal InvestedAmount,
    decimal CurrentValue,
    decimal? InterestRate,
    decimal? InstallmentAmount,
    DateOnly? StartDate,
    DateOnly? MaturityDate,
    string? Institution,
    string? PolicyOrAccountNumber,
    string? Note,
    string? Color,
    string? Icon,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    bool Archived);

public static class InvestmentTypes
{
    public const string RecurringDeposit = "recurring_deposit";
    public const string FixedDeposit = "fixed_deposit";
    public const string InsurancePolicy = "insurance_policy";
    public const string MutualFund = "mutual_fund";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        RecurringDeposit, FixedDeposit, InsurancePolicy, MutualFund,
    };
}
