namespace Artha.Api.Dtos;

public sealed record ExpenseCreateRequest(
    DateOnly Date,
    decimal Amount,
    string CategoryId,
    string AccountId,
    string? Note,
    bool Excluded = false,
    string? PlannedExpenseId = null);

public sealed record ExpenseUpdateRequest(
    DateOnly Date,
    decimal Amount,
    string CategoryId,
    string AccountId,
    string? Note,
    bool Excluded = false,
    string? PlannedExpenseId = null);

public sealed record ExpenseDto(
    string Id,
    DateOnly Date,
    decimal Amount,
    string Currency,
    string CategoryId,
    string AccountId,
    string? Note,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    bool Excluded = false,
    string? PlannedExpenseId = null);

public sealed record ExpenseListResponse(
    IReadOnlyList<ExpenseDto> Items,
    string Currency);
