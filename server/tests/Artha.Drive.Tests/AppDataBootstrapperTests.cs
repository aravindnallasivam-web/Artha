using Artha.Core.Drive;
using Artha.Core.Models;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;

namespace Artha.Drive.Tests;

public sealed class AppDataBootstrapperTests
{
    private static UserProfile SampleUser(string? locale = null) => new(
        GoogleUserId: $"user-{Guid.NewGuid():N}",
        Email: "alice@example.com",
        Name: "Alice Example",
        PictureUrl: null,
        Locale: locale);

    [Fact]
    public async Task EnsureInitializedAsync_CreatesDefaults_WhenManifestAbsent()
    {
        var drive = new InMemoryDriveClient();
        var bootstrapper = new AppDataBootstrapper(NullLogger<AppDataBootstrapper>.Instance);
        var user = SampleUser("en-IN");

        await bootstrapper.EnsureInitializedAsync(user.GoogleUserId, drive, user, CancellationToken.None);

        var snapshot = drive.Snapshot;
        snapshot.Should().ContainKey(DriveFileNames.Manifest);
        snapshot.Should().ContainKey(DriveFileNames.Categories);
        snapshot.Should().ContainKey(DriveFileNames.Settings);

        var categories = await new AppDataRepository<CategoryList>(drive)
            .ReadAsync(DriveFileNames.Categories, CancellationToken.None);
        categories!.Document.Items.Should().HaveCount(6);
        categories.Document.Items.Select(c => c.Name)
            .Should().Contain(new[] { "Food", "Transport", "Bills", "Entertainment", "Health", "Other" });

        var settings = await new AppDataRepository<SettingsDocument>(drive)
            .ReadAsync(DriveFileNames.Settings, CancellationToken.None);
        settings!.Document.Currency.Should().Be("INR");
    }

    [Fact]
    public async Task EnsureInitializedAsync_IsIdempotent_WhenManifestExists()
    {
        var drive = new InMemoryDriveClient();
        var bootstrapper = new AppDataBootstrapper(NullLogger<AppDataBootstrapper>.Instance);
        var user = SampleUser("en-US");

        await bootstrapper.EnsureInitializedAsync(user.GoogleUserId, drive, user, CancellationToken.None);
        var writesAfterFirst = drive.WriteCount;

        // Second invocation should write nothing.
        await bootstrapper.EnsureInitializedAsync(user.GoogleUserId, drive, user, CancellationToken.None);

        drive.WriteCount.Should().Be(writesAfterFirst);
    }

    [Theory]
    [InlineData("en-IN", "INR")]
    [InlineData("hi", "INR")]
    [InlineData("en-GB", "GBP")]
    [InlineData("en-US", "USD")]
    [InlineData("en-AU", "AUD")]
    [InlineData("en-CA", "CAD")]
    [InlineData("ja-JP", "JPY")]
    [InlineData("de-DE", "EUR")]
    [InlineData("fr-FR", "EUR")]
    [InlineData(null, "USD")]
    [InlineData("xyz", "USD")]
    public async Task DefaultCurrency_Matches_LocaleExpectations(string? locale, string expectedCurrency)
    {
        var drive = new InMemoryDriveClient();
        var bootstrapper = new AppDataBootstrapper(NullLogger<AppDataBootstrapper>.Instance);
        var user = SampleUser(locale);

        await bootstrapper.EnsureInitializedAsync(user.GoogleUserId, drive, user, CancellationToken.None);

        var settings = await new AppDataRepository<SettingsDocument>(drive)
            .ReadAsync(DriveFileNames.Settings, CancellationToken.None);
        settings!.Document.Currency.Should().Be(expectedCurrency);
    }
}
