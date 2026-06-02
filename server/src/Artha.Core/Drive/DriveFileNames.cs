using System.Text.RegularExpressions;

namespace Artha.Core.Drive;

public static partial class DriveFileNames
{
    public const string Manifest = "manifest.json";
    public const string Categories = "categories.json";
    public const string Accounts = "accounts.json";
    public const string Investments = "investments.json";
    public const string Settings = "settings.json";

    /// <summary>
    /// Well-known ID of the default Cash account seeded for every user. Used
    /// as the implicit account for legacy expenses written before the
    /// accounts feature shipped (M5).
    /// </summary>
    public const string DefaultAccountId = "acc-cash";

    public const string ExpenseShardPrefix = "expenses-";
    private const string ExpenseShardSuffix = ".json";

    public static string ShardFor(YearMonth month) =>
        $"{ExpenseShardPrefix}{month.Year:0000}-{month.Month:00}{ExpenseShardSuffix}";

    public static string ShardFor(DateOnly date) =>
        ShardFor(YearMonth.From(date));

    public static bool TryParseShardName(string fileName, out YearMonth month)
    {
        var match = ExpenseShardRegex().Match(fileName);
        if (!match.Success)
        {
            month = default;
            return false;
        }
        month = new YearMonth(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value));
        return true;
    }

    [GeneratedRegex(@"^expenses-(\d{4})-(\d{2})\.json$")]
    private static partial Regex ExpenseShardRegex();
}

public readonly record struct YearMonth(int Year, int Month) : IComparable<YearMonth>
{
    public static YearMonth From(DateOnly date) => new(date.Year, date.Month);

    public static YearMonth Parse(string yyyyMm)
    {
        var parts = yyyyMm.Split('-');
        if (parts.Length != 2 ||
            !int.TryParse(parts[0], out var year) ||
            !int.TryParse(parts[1], out var month))
        {
            throw new FormatException($"Expected YYYY-MM, got '{yyyyMm}'.");
        }
        return new YearMonth(year, month);
    }

    public override string ToString() => $"{Year:0000}-{Month:00}";

    public int CompareTo(YearMonth other)
    {
        var byYear = Year.CompareTo(other.Year);
        return byYear != 0 ? byYear : Month.CompareTo(other.Month);
    }

    public YearMonth AddMonths(int delta)
    {
        var total = (Year * 12) + (Month - 1) + delta;
        var (q, r) = (Math.DivRem(total, 12));
        return new YearMonth(q, r + 1);
    }
}
