using System.Collections.Concurrent;
using Artha.Core.Drive;
using Artha.Core.Models;
using Microsoft.Extensions.Logging;

namespace Artha.Drive;

/// <summary>
/// On a user's first Drive-backed request, ensure manifest.json /
/// categories.json / settings.json exist with sensible defaults. Idempotent:
/// subsequent calls are a single Drive lookup.
/// </summary>
public sealed class AppDataBootstrapper
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> UserGates = new();

    private readonly ILogger<AppDataBootstrapper> _logger;

    public AppDataBootstrapper(ILogger<AppDataBootstrapper> logger)
    {
        _logger = logger;
    }

    public async Task EnsureInitializedAsync(
        string userId,
        IDriveClient drive,
        UserProfile profile,
        CancellationToken cancellationToken)
    {
        // Fast path: manifest exists, nothing to do.
        if (await drive.GetByNameAsync(DriveFileNames.Manifest, cancellationToken) is not null)
        {
            return;
        }

        var gate = UserGates.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            // Re-check under the lock: a concurrent first-request may have done it.
            if (await drive.GetByNameAsync(DriveFileNames.Manifest, cancellationToken) is not null)
            {
                return;
            }

            _logger.LogInformation("Bootstrapping Drive appdata for user {UserId}", userId);

            var categories = BuildDefaultCategories();
            var settings = new SettingsDocument(
                SchemaVersion: SchemaVersions.Current,
                Currency: DefaultCurrencyFor(profile.Locale),
                FirstRunCompleted: false,
                Locale: profile.Locale);
            var manifest = new Manifest(
                SchemaVersion: SchemaVersions.Current,
                Shards: Array.Empty<string>(),
                CreatedAt: DateTimeOffset.UtcNow);

            var categoryRepo = new AppDataRepository<CategoryList>(drive);
            var settingsRepo = new AppDataRepository<SettingsDocument>(drive);
            var manifestRepo = new AppDataRepository<Manifest>(drive);

            // Order matters: write data files first, then manifest last so a
            // crashed bootstrap doesn't leave a manifest pointing at nothing.
            await categoryRepo.WriteAsync(DriveFileNames.Categories, new CategoryList(SchemaVersions.Current, categories), cancellationToken);
            await settingsRepo.WriteAsync(DriveFileNames.Settings, settings, cancellationToken);
            await manifestRepo.WriteAsync(DriveFileNames.Manifest, manifest, cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    internal static IReadOnlyList<Category> BuildDefaultCategories() =>
    [
        new("cat-food",          "Food",          "#ef4444", "restaurant",       false),
        new("cat-transport",     "Transport",     "#3b82f6", "car",              false),
        new("cat-bills",         "Bills",         "#f59e0b", "receipt",          false),
        new("cat-entertainment", "Entertainment", "#a855f7", "musical-notes",    false),
        new("cat-health",        "Health",        "#22c55e", "medkit",           false),
        new("cat-other",         "Other",         "#64748b", "ellipsis-horizontal", false),
    ];

    internal static string DefaultCurrencyFor(string? locale)
    {
        if (string.IsNullOrEmpty(locale))
        {
            return "USD";
        }
        var lower = locale.Replace('_', '-').ToLowerInvariant();
        if (lower.StartsWith("en-in", StringComparison.Ordinal) || lower.StartsWith("hi", StringComparison.Ordinal))
        {
            return "INR";
        }
        if (lower.StartsWith("en-gb", StringComparison.Ordinal))
        {
            return "GBP";
        }
        if (lower.StartsWith("en-au", StringComparison.Ordinal))
        {
            return "AUD";
        }
        if (lower.StartsWith("en-ca", StringComparison.Ordinal))
        {
            return "CAD";
        }
        if (lower.StartsWith("ja", StringComparison.Ordinal))
        {
            return "JPY";
        }
        if (lower.StartsWith("de", StringComparison.Ordinal) ||
            lower.StartsWith("fr", StringComparison.Ordinal) ||
            lower.StartsWith("es", StringComparison.Ordinal) ||
            lower.StartsWith("it", StringComparison.Ordinal) ||
            lower.StartsWith("nl", StringComparison.Ordinal) ||
            lower.StartsWith("pt", StringComparison.Ordinal) ||
            lower.StartsWith("en-ie", StringComparison.Ordinal))
        {
            return "EUR";
        }
        return "USD";
    }
}
