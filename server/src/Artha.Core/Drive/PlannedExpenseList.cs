using Artha.Core.Models;

namespace Artha.Core.Drive;

public sealed record PlannedExpenseList(
    int SchemaVersion,
    IReadOnlyList<PlannedExpense> Items) : ISchemaVersioned
{
    public static PlannedExpenseList Empty() => new(SchemaVersions.Current, Array.Empty<PlannedExpense>());
}
