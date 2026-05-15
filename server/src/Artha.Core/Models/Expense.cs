namespace Artha.Core.Models;

public sealed record Expense(
    string Id,
    DateOnly Date,
    decimal Amount,
    string Currency,
    string CategoryId,
    // Nullable to remain backwards-compatible with shards written before
    // M5 (the accounts feature). The API substitutes the default account
    // when surfacing legacy rows; new and updated expenses always populate
    // this field.
    string? AccountId,
    string? Note,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
