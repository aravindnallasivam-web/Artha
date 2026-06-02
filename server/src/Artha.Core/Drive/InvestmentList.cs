using Artha.Core.Models;

namespace Artha.Core.Drive;

public sealed record InvestmentList(
    int SchemaVersion,
    IReadOnlyList<Investment> Items) : ISchemaVersioned
{
    public static InvestmentList Empty() => new(SchemaVersions.Current, Array.Empty<Investment>());
}
