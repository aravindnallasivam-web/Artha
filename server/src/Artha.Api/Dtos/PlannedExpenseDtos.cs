namespace Artha.Api.Dtos;

public sealed record PlannedExpenseUpsertRequest(
    string Name,
    decimal Amount,
    string? CategoryId,
    int? DayOfMonth,
    string Cycle = "monthly");

public sealed record PlannedExpenseDto(
    string Id,
    string Name,
    decimal Amount,
    string? CategoryId,
    int? DayOfMonth,
    bool Archived,
    string Cycle);
