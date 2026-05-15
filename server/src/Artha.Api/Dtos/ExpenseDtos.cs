namespace Artha.Api.Dtos;

public sealed record ExpenseCreateRequest(
    DateOnly Date,
    decimal Amount,
    string CategoryId,
    string? Note);

public sealed record ExpenseUpdateRequest(
    DateOnly Date,
    decimal Amount,
    string CategoryId,
    string? Note);

public sealed record ExpenseDto(
    string Id,
    DateOnly Date,
    decimal Amount,
    string Currency,
    string CategoryId,
    string? Note,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ExpenseListResponse(
    IReadOnlyList<ExpenseDto> Items,
    string Currency);
