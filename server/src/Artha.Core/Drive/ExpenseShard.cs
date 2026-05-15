using Artha.Core.Models;

namespace Artha.Core.Drive;

public sealed record ExpenseShard(
    int SchemaVersion,
    IReadOnlyList<Expense> Items) : ISchemaVersioned
{
    public static ExpenseShard Empty() => new(SchemaVersions.Current, Array.Empty<Expense>());
}
