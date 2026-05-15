namespace Artha.Api.Dtos;

/// <summary>
/// Body of a 409 Conflict problem-details response when a Drive optimistic
/// concurrency check fails. The client can re-read with the new etag and
/// reapply the change.
/// </summary>
public sealed record ConflictExtensions(string FileName, string? CurrentEtag);
