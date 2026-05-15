using System.Text.Json;
using Artha.Core.Drive;

namespace Artha.Api.Middleware;

/// <summary>
/// Translates Drive errors into clean HTTP responses so controllers don't
/// need try/catch boilerplate:
///   - DriveConflictException        -> 409 Conflict + problem+json
///   - UnauthorizedAccessException   -> 401 Unauthorized + problem+json
///     (raised by GoogleDriveClientFactory when the in-memory token store
///     was wiped by a process restart; the client interceptor turns 401
///     into a redirect to /login so the user can re-auth.)
/// </summary>
public sealed class DriveConflictMiddleware
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly ILogger<DriveConflictMiddleware> _logger;

    public DriveConflictMiddleware(RequestDelegate next, ILogger<DriveConflictMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (DriveConflictException ex)
        {
            _logger.LogInformation(
                "Drive conflict on '{FileName}'; returning 409. CurrentRevision={CurrentRev}",
                ex.FileName, ex.CurrentHeadRevisionId);

            if (context.Response.HasStarted)
            {
                throw;
            }

            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status409Conflict;
            context.Response.ContentType = "application/problem+json";

            var payload = new
            {
                type = "https://artha.example/problems/drive-conflict",
                title = "Drive optimistic concurrency check failed",
                status = 409,
                detail = ex.Message,
                fileName = ex.FileName,
                currentEtag = ex.CurrentHeadRevisionId,
            };

            await JsonSerializer.SerializeAsync(context.Response.Body, payload, JsonOptions);
        }
        catch (UnauthorizedAccessException ex)
        {
            _logger.LogInformation(
                "Drive auth missing for the current user; returning 401. {Message}",
                ex.Message);

            if (context.Response.HasStarted)
            {
                throw;
            }

            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.ContentType = "application/problem+json";

            var payload = new
            {
                type = "https://artha.example/problems/drive-reauth-required",
                title = "Drive re-authentication required",
                status = 401,
                detail = "Server-side Drive tokens are missing — please sign in again.",
            };

            await JsonSerializer.SerializeAsync(context.Response.Body, payload, JsonOptions);
        }
    }
}
