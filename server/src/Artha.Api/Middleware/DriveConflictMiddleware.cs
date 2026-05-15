using System.Text.Json;
using Artha.Core.Drive;

namespace Artha.Api.Middleware;

/// <summary>
/// Translates Drive optimistic-concurrency failures into 409 problem+json
/// so controllers don't need try/catch boilerplate.
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
    }
}
