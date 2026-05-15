using System.Collections.Concurrent;
using Artha.Core.Drive;

namespace Artha.Api.Tests.Infrastructure;

/// <summary>In-memory IDriveClient for integration tests.</summary>
public sealed class InMemoryDriveClient : IDriveClient
{
    private readonly ConcurrentDictionary<string, Entry> _byName = new(StringComparer.Ordinal);
    private long _revisionCounter;

    public Task<DriveReadResult?> GetByNameAsync(string name, CancellationToken cancellationToken)
    {
        if (!_byName.TryGetValue(name, out var entry))
        {
            return Task.FromResult<DriveReadResult?>(null);
        }
        return Task.FromResult<DriveReadResult?>(
            new DriveReadResult(entry.Id, name, entry.HeadRevisionId, entry.Content));
    }

    public Task<DriveFile> CreateAsync(string name, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        var entry = new Entry(
            Id: Guid.NewGuid().ToString("N"),
            Content: content,
            HeadRevisionId: NextRevisionId());

        if (!_byName.TryAdd(name, entry))
        {
            throw new InvalidOperationException($"File '{name}' already exists.");
        }
        return Task.FromResult(new DriveFile(entry.Id, name, entry.HeadRevisionId, content.LongLength));
    }

    public Task<DriveFile> UpdateAsync(string fileId, byte[] content, string contentType, string? ifMatchHeadRevisionId, CancellationToken cancellationToken)
    {
        var kv = _byName.FirstOrDefault(pair => pair.Value.Id == fileId);
        if (kv.Key is null)
        {
            throw new InvalidOperationException($"File id '{fileId}' not found.");
        }

        if (!string.IsNullOrEmpty(ifMatchHeadRevisionId) &&
            !string.Equals(kv.Value.HeadRevisionId, ifMatchHeadRevisionId, StringComparison.Ordinal))
        {
            throw new DriveConflictException(kv.Key, kv.Value.HeadRevisionId);
        }

        var updated = kv.Value with { Content = content, HeadRevisionId = NextRevisionId() };
        _byName[kv.Key] = updated;
        return Task.FromResult(new DriveFile(updated.Id, kv.Key, updated.HeadRevisionId, content.LongLength));
    }

    public Task<IReadOnlyList<DriveFile>> ListAsync(string? namePrefix, CancellationToken cancellationToken)
    {
        IEnumerable<KeyValuePair<string, Entry>> source = _byName;
        if (!string.IsNullOrEmpty(namePrefix))
        {
            source = source.Where(kv => kv.Key.StartsWith(namePrefix, StringComparison.Ordinal));
        }
        IReadOnlyList<DriveFile> files = source
            .Select(kv => new DriveFile(kv.Value.Id, kv.Key, kv.Value.HeadRevisionId, kv.Value.Content.LongLength))
            .ToList();
        return Task.FromResult(files);
    }

    public Task DeleteAsync(string fileId, CancellationToken cancellationToken)
    {
        var kv = _byName.FirstOrDefault(pair => pair.Value.Id == fileId);
        if (kv.Key is not null)
        {
            _byName.TryRemove(kv.Key, out _);
        }
        return Task.CompletedTask;
    }

    private string NextRevisionId() => Interlocked.Increment(ref _revisionCounter).ToString("X16");

    internal sealed record Entry(string Id, byte[] Content, string HeadRevisionId);
}

public sealed class InMemoryDriveClientFactory : IDriveClientFactory
{
    private readonly ConcurrentDictionary<string, InMemoryDriveClient> _byUser = new();

    public Task<IDriveClient> CreateForUserAsync(string userId, CancellationToken cancellationToken)
    {
        var client = _byUser.GetOrAdd(userId, _ => new InMemoryDriveClient());
        return Task.FromResult<IDriveClient>(client);
    }

    public InMemoryDriveClient For(string userId) =>
        _byUser.GetOrAdd(userId, _ => new InMemoryDriveClient());
}
