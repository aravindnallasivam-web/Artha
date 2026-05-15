namespace Artha.Core.Drive;

public sealed record DriveReadResult(
    string FileId,
    string Name,
    string HeadRevisionId,
    byte[] Content);
