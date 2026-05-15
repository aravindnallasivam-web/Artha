using System.Text.Json;
using Artha.Core.Drive;
using Artha.Core.Models;
using FluentAssertions;

namespace Artha.Core.Tests;

public sealed class ExpenseTests
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [Fact]
    public void Expense_RoundTripsThroughJson()
    {
        var original = new Expense(
            Id: "exp-1",
            Date: new DateOnly(2026, 5, 15),
            Amount: 12.50m,
            Currency: "USD",
            CategoryId: "cat-food",
            AccountId: "acc-cash",
            Note: "Lunch",
            CreatedAt: new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero),
            UpdatedAt: new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero));

        var json = JsonSerializer.Serialize(original, Options);
        json.Should().Contain("\"date\":\"2026-05-15\"");
        json.Should().Contain("\"amount\":12.50");

        var deserialized = JsonSerializer.Deserialize<Expense>(json, Options);

        deserialized.Should().Be(original);
    }

    [Fact]
    public void ExpenseShard_DefaultsToCurrentSchemaVersion()
    {
        var shard = ExpenseShard.Empty();

        shard.SchemaVersion.Should().Be(SchemaVersions.Current);
        shard.Items.Should().BeEmpty();
    }

    [Fact]
    public void YearMonth_FromDate_ProducesExpectedShardName()
    {
        var date = new DateOnly(2026, 5, 15);
        var shardName = DriveFileNames.ShardFor(date);

        shardName.Should().Be("expenses-2026-05.json");
        DriveFileNames.TryParseShardName(shardName, out var month).Should().BeTrue();
        month.Should().Be(new YearMonth(2026, 5));
    }

    [Fact]
    public void YearMonth_AddMonths_HandlesYearBoundaries()
    {
        new YearMonth(2026, 1).AddMonths(-1).Should().Be(new YearMonth(2025, 12));
        new YearMonth(2026, 12).AddMonths(1).Should().Be(new YearMonth(2027, 1));
        new YearMonth(2026, 5).AddMonths(0).Should().Be(new YearMonth(2026, 5));
    }
}
