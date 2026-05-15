namespace Artha.Core.Drive;

public sealed record SettingsDocument(
    int SchemaVersion,
    string Currency,
    bool FirstRunCompleted,
    string? Locale) : ISchemaVersioned;
