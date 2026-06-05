namespace Artha.Api.Dtos;

public sealed record CategoryUpsertRequest(
    string Name,
    string? Color,
    string? Icon,
    bool ExcludeFromReports = false);

public sealed record CategoryDto(
    string Id,
    string Name,
    string? Color,
    string? Icon,
    bool Archived,
    bool ExcludeFromReports);

public sealed record CategoryMergeRequest(
    string TargetId,
    IReadOnlyList<string> SourceIds);
