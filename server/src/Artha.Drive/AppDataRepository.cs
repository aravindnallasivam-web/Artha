using System.Text.Json;
using System.Text.Json.Serialization;
using Artha.Core.Drive;

namespace Artha.Drive;

/// <summary>
/// Typed JSON wrapper over <see cref="IDriveClient"/>. Handles serialization,
/// schema-version guard, and surfaces ETags (headRevisionId) for optimistic
/// concurrency.
/// </summary>
public sealed class AppDataRepository<T> where T : class
{
    private const string ContentType = "application/json";

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        WriteIndented = false,
    };

    private readonly IDriveClient _drive;

    public AppDataRepository(IDriveClient drive)
    {
        _drive = drive;
    }

    public async Task<RepositoryDocument<T>?> ReadAsync(string fileName, CancellationToken cancellationToken)
    {
        var result = await _drive.GetByNameAsync(fileName, cancellationToken);
        if (result is null)
        {
            return null;
        }

        var doc = JsonSerializer.Deserialize<T>(result.Content, JsonOptions)
            ?? throw new InvalidOperationException($"Drive file '{fileName}' deserialized to null.");

        GuardSchemaVersion(doc, fileName);

        return new RepositoryDocument<T>(
            Document: doc,
            FileId: result.FileId,
            ETag: result.HeadRevisionId);
    }

    /// <summary>
    /// Create if absent, otherwise update with optional optimistic-concurrency check.
    /// Returns the new ETag.
    /// </summary>
    public async Task<string> WriteAsync(
        string fileName,
        T document,
        string? ifMatchETag,
        CancellationToken cancellationToken)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);
        var existing = await _drive.GetByNameAsync(fileName, cancellationToken);

        if (existing is null)
        {
            var created = await _drive.CreateAsync(fileName, bytes, ContentType, cancellationToken);
            return created.HeadRevisionId;
        }

        if (!string.IsNullOrEmpty(ifMatchETag) &&
            !string.Equals(existing.HeadRevisionId, ifMatchETag, StringComparison.Ordinal))
        {
            throw new DriveConflictException(fileName, existing.HeadRevisionId);
        }

        var updated = await _drive.UpdateAsync(
            existing.FileId,
            bytes,
            ContentType,
            ifMatchETag,
            cancellationToken);
        return updated.HeadRevisionId;
    }

    public Task<string> WriteAsync(string fileName, T document, CancellationToken cancellationToken) =>
        WriteAsync(fileName, document, ifMatchETag: null, cancellationToken);

    private static void GuardSchemaVersion(T document, string fileName)
    {
        if (document is ISchemaVersioned versioned && versioned.SchemaVersion > SchemaVersions.Current)
        {
            throw new InvalidOperationException(
                $"Drive file '{fileName}' has schemaVersion {versioned.SchemaVersion}, " +
                $"newer than supported ({SchemaVersions.Current}). " +
                $"Upgrade the Artha server.");
        }
    }
}

public sealed record RepositoryDocument<T>(T Document, string FileId, string ETag);
