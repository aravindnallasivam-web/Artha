namespace Artha.Api.Dtos;

public sealed record CategoryUpsertRequest(
    string Name,
    string? Color,
    string? Icon);

public sealed record CategoryDto(
    string Id,
    string Name,
    string? Color,
    string? Icon,
    bool Archived);

public sealed record CategoryMergeRequest(
    string TargetId,
    IReadOnlyList<string> SourceIds);
