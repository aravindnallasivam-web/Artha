using Artha.Core.Models;

namespace Artha.Core.Drive;

public sealed record AccountList(
    int SchemaVersion,
    IReadOnlyList<Account> Items) : ISchemaVersioned
{
    public static AccountList Empty() => new(SchemaVersions.Current, Array.Empty<Account>());
}
