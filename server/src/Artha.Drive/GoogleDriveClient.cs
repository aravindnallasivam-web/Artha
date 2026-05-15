using System.Net;
using Artha.Core.Drive;
using Google;
using Google.Apis.Download;
using Google.Apis.Drive.v3;
using Google.Apis.Upload;
using DriveFileMeta = Google.Apis.Drive.v3.Data.File;

namespace Artha.Drive;

/// <summary>
/// Drive v3 SDK adapter restricted to the user's <c>appDataFolder</c> space.
/// </summary>
public sealed class GoogleDriveClient : IDriveClient, IDisposable
{
    private const string AppDataFolder = "appDataFolder";
    private const string FileFields = "id,name,headRevisionId,size";
    private const string ListFields = "files(id,name,headRevisionId,size),nextPageToken";

    private readonly DriveService _service;
    private readonly bool _ownsService;

    public GoogleDriveClient(DriveService service, bool ownsService = true)
    {
        _service = service;
        _ownsService = ownsService;
    }

    public async Task<DriveReadResult?> GetByNameAsync(string name, CancellationToken cancellationToken)
    {
        var meta = await FindByNameAsync(name, cancellationToken);
        if (meta is null)
        {
            return null;
        }

        await using var buffer = new MemoryStream();
        var download = await _service.Files.Get(meta.Id).DownloadAsync(buffer, cancellationToken);
        if (download.Status == DownloadStatus.Failed && download.Exception is not null)
        {
            throw download.Exception;
        }

        return new DriveReadResult(
            FileId: meta.Id,
            Name: meta.Name,
            HeadRevisionId: meta.HeadRevisionId ?? string.Empty,
            Content: buffer.ToArray());
    }

    public async Task<DriveFile> CreateAsync(
        string name,
        byte[] content,
        string contentType,
        CancellationToken cancellationToken)
    {
        var fileMetadata = new DriveFileMeta
        {
            Name = name,
            Parents = new List<string> { AppDataFolder },
        };

        using var stream = new MemoryStream(content, writable: false);
        var request = _service.Files.Create(fileMetadata, stream, contentType);
        request.Fields = FileFields;

        var progress = await request.UploadAsync(cancellationToken);
        if (progress.Status != UploadStatus.Completed)
        {
            throw progress.Exception ?? new InvalidOperationException(
                $"Drive upload for '{name}' ended in status {progress.Status}.");
        }

        var created = request.ResponseBody
            ?? throw new InvalidOperationException($"Drive upload for '{name}' returned no metadata.");

        return ToDriveFile(created);
    }

    public async Task<DriveFile> UpdateAsync(
        string fileId,
        byte[] content,
        string contentType,
        string? ifMatchHeadRevisionId,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(ifMatchHeadRevisionId))
        {
            var currentMeta = await _service.Files.Get(fileId)
                .WithFields(FileFields)
                .ExecuteAsync(cancellationToken);

            if (!string.Equals(currentMeta.HeadRevisionId, ifMatchHeadRevisionId, StringComparison.Ordinal))
            {
                throw new DriveConflictException(currentMeta.Name, currentMeta.HeadRevisionId);
            }
        }

        using var stream = new MemoryStream(content, writable: false);
        // The metadata body must be empty (no Name / no Parents) on Update.
        var request = _service.Files.Update(new DriveFileMeta(), fileId, stream, contentType);
        request.Fields = FileFields;

        IUploadProgress progress;
        try
        {
            progress = await request.UploadAsync(cancellationToken);
        }
        catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.PreconditionFailed)
        {
            throw new DriveConflictException(fileId, currentHeadRevisionId: null, message: ex.Message);
        }

        if (progress.Status != UploadStatus.Completed)
        {
            throw progress.Exception ?? new InvalidOperationException(
                $"Drive update for file '{fileId}' ended in status {progress.Status}.");
        }

        return ToDriveFile(request.ResponseBody
            ?? throw new InvalidOperationException($"Drive update for '{fileId}' returned no metadata."));
    }

    public async Task<IReadOnlyList<DriveFile>> ListAsync(string? namePrefix, CancellationToken cancellationToken)
    {
        var results = new List<DriveFile>();
        string? pageToken = null;

        do
        {
            var request = _service.Files.List();
            request.Spaces = AppDataFolder;
            request.Fields = ListFields;
            request.PageSize = 100;
            request.PageToken = pageToken;
            if (!string.IsNullOrEmpty(namePrefix))
            {
                request.Q = $"name contains '{EscapeForDriveQuery(namePrefix)}'";
            }

            var page = await request.ExecuteAsync(cancellationToken);
            if (page.Files is not null)
            {
                foreach (var file in page.Files)
                {
                    // `name contains` matches anywhere; filter to true prefix.
                    if (string.IsNullOrEmpty(namePrefix) ||
                        file.Name.StartsWith(namePrefix, StringComparison.Ordinal))
                    {
                        results.Add(ToDriveFile(file));
                    }
                }
            }
            pageToken = page.NextPageToken;
        }
        while (!string.IsNullOrEmpty(pageToken));

        return results;
    }

    public async Task DeleteAsync(string fileId, CancellationToken cancellationToken)
    {
        await _service.Files.Delete(fileId).ExecuteAsync(cancellationToken);
    }

    public void Dispose()
    {
        if (_ownsService)
        {
            _service.Dispose();
        }
    }

    private async Task<DriveFileMeta?> FindByNameAsync(string name, CancellationToken cancellationToken)
    {
        var request = _service.Files.List();
        request.Spaces = AppDataFolder;
        request.Fields = ListFields;
        request.PageSize = 10;
        request.Q = $"name = '{EscapeForDriveQuery(name)}' and trashed = false";

        var page = await request.ExecuteAsync(cancellationToken);
        return page.Files?.FirstOrDefault();
    }

    private static DriveFile ToDriveFile(DriveFileMeta f) =>
        new(Id: f.Id,
            Name: f.Name,
            HeadRevisionId: f.HeadRevisionId ?? string.Empty,
            Size: f.Size);

    private static string EscapeForDriveQuery(string raw) =>
        raw.Replace("\\", "\\\\").Replace("'", "\\'");
}

internal static class FilesGetRequestExtensions
{
    public static FilesResource.GetRequest WithFields(this FilesResource.GetRequest request, string fields)
    {
        request.Fields = fields;
        return request;
    }
}
