namespace Artha.Core.Drive;

public interface IDriveClient
{
    Task<DriveReadResult?> GetByNameAsync(string name, CancellationToken cancellationToken);

    Task<DriveFile> CreateAsync(
        string name,
        byte[] content,
        string contentType,
        CancellationToken cancellationToken);

    Task<DriveFile> UpdateAsync(
        string fileId,
        byte[] content,
        string contentType,
        string? ifMatchHeadRevisionId,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<DriveFile>> ListAsync(
        string? namePrefix,
        CancellationToken cancellationToken);

    Task DeleteAsync(string fileId, CancellationToken cancellationToken);
}
