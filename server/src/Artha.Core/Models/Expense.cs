namespace Artha.Core.Models;

public sealed record Expense(
    string Id,
    DateOnly Date,
    decimal Amount,
    string Currency,
    string CategoryId,
    string? Note,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
