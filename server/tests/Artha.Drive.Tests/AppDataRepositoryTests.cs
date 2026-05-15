using Artha.Core.Drive;
using Artha.Core.Models;
using FluentAssertions;

namespace Artha.Drive.Tests;

public sealed class AppDataRepositoryTests
{
    private static Expense Sample(string id) => new(
        Id: id,
        Date: new DateOnly(2026, 5, 15),
        Amount: 12.50m,
        Currency: "USD",
        CategoryId: "cat-food",
        Note: "Lunch",
        CreatedAt: new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero),
        UpdatedAt: new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero));

    [Fact]
    public async Task ReadAsync_ReturnsNull_WhenFileMissing()
    {
        var drive = new InMemoryDriveClient();
        var repo = new AppDataRepository<ExpenseShard>(drive);

        var result = await repo.ReadAsync("expenses-2026-05.json", CancellationToken.None);

        result.Should().BeNull();
    }

    [Fact]
    public async Task WriteThenRead_RoundTrips()
    {
        var drive = new InMemoryDriveClient();
        var repo = new AppDataRepository<ExpenseShard>(drive);

        var shard = new ExpenseShard(SchemaVersions.Current, new[] { Sample("exp-1") });
        var etag = await repo.WriteAsync("expenses-2026-05.json", shard, CancellationToken.None);
        etag.Should().NotBeNullOrEmpty();

        var roundtrip = await repo.ReadAsync("expenses-2026-05.json", CancellationToken.None);

        roundtrip.Should().NotBeNull();
        roundtrip!.Document.SchemaVersion.Should().Be(SchemaVersions.Current);
        roundtrip.Document.Items.Should().HaveCount(1);
        roundtrip.Document.Items[0].Should().BeEquivalentTo(Sample("exp-1"));
        roundtrip.ETag.Should().Be(etag);
    }

    [Fact]
    public async Task WriteAsync_WithMatchingIfMatch_Succeeds()
    {
        var drive = new InMemoryDriveClient();
        var repo = new AppDataRepository<ExpenseShard>(drive);

        var v1 = new ExpenseShard(SchemaVersions.Current, new[] { Sample("exp-1") });
        var firstEtag = await repo.WriteAsync("expenses-2026-05.json", v1, CancellationToken.None);

        var v2 = v1 with { Items = new[] { Sample("exp-1"), Sample("exp-2") } };
        var secondEtag = await repo.WriteAsync("expenses-2026-05.json", v2, firstEtag, CancellationToken.None);

        secondEtag.Should().NotBe(firstEtag);
        var roundtrip = await repo.ReadAsync("expenses-2026-05.json", CancellationToken.None);
        roundtrip!.Document.Items.Should().HaveCount(2);
    }

    [Fact]
    public async Task WriteAsync_WithStaleIfMatch_ThrowsConflict()
    {
        var drive = new InMemoryDriveClient();
        var repo = new AppDataRepository<ExpenseShard>(drive);

        var initial = new ExpenseShard(SchemaVersions.Current, new[] { Sample("exp-1") });
        var firstEtag = await repo.WriteAsync("expenses-2026-05.json", initial, CancellationToken.None);

        // Some other writer bumps the file forward.
        await repo.WriteAsync("expenses-2026-05.json", initial with { Items = new[] { Sample("exp-other") } }, firstEtag, CancellationToken.None);

        // Now our write with the stale ETag must fail.
        var attempt = new ExpenseShard(SchemaVersions.Current, new[] { Sample("exp-1"), Sample("exp-2") });

        Func<Task> act = () => repo.WriteAsync("expenses-2026-05.json", attempt, firstEtag, CancellationToken.None);

        await act.Should().ThrowAsync<DriveConflictException>()
            .Where(ex => ex.FileName == "expenses-2026-05.json" && ex.CurrentHeadRevisionId != firstEtag);
    }

    [Fact]
    public async Task ReadAsync_RejectsNewerSchemaVersion()
    {
        var drive = new InMemoryDriveClient();
        // Stash a doc with a schema version newer than the server understands.
        var future = new ExpenseShard(SchemaVersion: SchemaVersions.Current + 1, Items: Array.Empty<Expense>());
        var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(future, AppDataRepository<ExpenseShard>.JsonOptions);
        await drive.CreateAsync("expenses-2026-05.json", bytes, "application/json", CancellationToken.None);

        var repo = new AppDataRepository<ExpenseShard>(drive);

        Func<Task> act = () => repo.ReadAsync("expenses-2026-05.json", CancellationToken.None);

        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*schemaVersion*");
    }
}
