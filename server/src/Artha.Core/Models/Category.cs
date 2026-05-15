namespace Artha.Core.Models;

public sealed record Category(
    string Id,
    string Name,
    string? Color,
    string? Icon,
    bool Archived);
