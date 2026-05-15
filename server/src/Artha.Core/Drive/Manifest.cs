namespace Artha.Core.Drive;

public sealed record Manifest(
    int SchemaVersion,
    IReadOnlyList<string> Shards,
    DateTimeOffset CreatedAt) : ISchemaVersioned;
