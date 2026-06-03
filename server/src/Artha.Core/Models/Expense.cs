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
    DateTimeOffset UpdatedAt,
    // Marks a transaction that should be excluded from spending totals/counts
    // (e.g. a refund, transfer or settlement). Defaults to false so shards
    // written before this field deserialize cleanly.
    bool Excluded = false,
    // Optional link to a PlannedExpense this transaction fulfils (e.g. this
    // month's rent payment). Null for unlinked expenses. Lets reports show
    // which planned bills have been paid.
    string? PlannedExpenseId = null);
