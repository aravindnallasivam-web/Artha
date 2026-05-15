namespace Artha.Core.Drive;

public sealed record DriveFile(
    string Id,
    string Name,
    string HeadRevisionId,
    long? Size);
