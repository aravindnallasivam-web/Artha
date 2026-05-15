using Artha.Core.Drive;

namespace Artha.Api.Drive;

internal static class ExpenseShardOps
{
    /// <summary>Enumerates [from, to] inclusive, with from &lt;= to.</summary>
    public static IEnumerable<YearMonth> EnumerateMonths(YearMonth from, YearMonth to)
    {
        if (from.CompareTo(to) > 0)
        {
            yield break;
        }
        var cursor = from;
        while (cursor.CompareTo(to) <= 0)
        {
            yield return cursor;
            cursor = cursor.AddMonths(1);
        }
    }

    /// <summary>
    /// Intersect a requested date range with the shards the user actually has,
    /// in chronological order. Returns shard names (e.g. "expenses-2026-05.json").
    /// </summary>
    public static IReadOnlyList<string> ShardsInRange(Manifest manifest, YearMonth from, YearMonth to)
    {
        var byMonth = new HashSet<YearMonth>();
        foreach (var shard in manifest.Shards)
        {
            try
            {
                byMonth.Add(YearMonth.Parse(shard));
            }
            catch (FormatException)
            {
                // Skip unrecognised entries.
            }
        }

        var result = new List<string>();
        foreach (var month in EnumerateMonths(from, to))
        {
            if (byMonth.Contains(month))
            {
                result.Add(DriveFileNames.ShardFor(month));
            }
        }
        return result;
    }

    /// <summary>Reverse-chronological iteration of manifest shards, for lookup-by-id.</summary>
    public static IEnumerable<(YearMonth Month, string FileName)> ShardsNewestFirst(Manifest manifest)
    {
        return manifest.Shards
            .Select(s => { try { return (YearMonth?)YearMonth.Parse(s); } catch { return null; } })
            .Where(m => m.HasValue)
            .Select(m => m!.Value)
            .OrderByDescending(m => m)
            .Select(m => (m, DriveFileNames.ShardFor(m)));
    }
}
