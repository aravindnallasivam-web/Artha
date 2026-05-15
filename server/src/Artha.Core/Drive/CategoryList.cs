using Artha.Core.Models;

namespace Artha.Core.Drive;

public sealed record CategoryList(
    int SchemaVersion,
    IReadOnlyList<Category> Items) : ISchemaVersioned
{
    public static CategoryList Empty() => new(SchemaVersions.Current, Array.Empty<Category>());
}
