namespace Artha.Api.Dtos;

public sealed record AccountDto(
    string Id,
    string Name,
    string Type,
    string Currency,
    decimal OpeningBalance,
    string? Color,
    string? Icon,
    bool Archived);

public sealed record AccountUpsertRequest(
    string Name,
    string Type,
    string Currency,
    decimal OpeningBalance,
    string? Color,
    string? Icon);
