namespace Artha.Core.Drive;

public sealed class DriveConflictException : Exception
{
    public DriveConflictException(string fileName, string? currentHeadRevisionId, string? message = null)
        : base(message ?? $"Drive file '{fileName}' was modified by another writer.")
    {
        FileName = fileName;
        CurrentHeadRevisionId = currentHeadRevisionId;
    }

    public string FileName { get; }

    public string? CurrentHeadRevisionId { get; }
}
