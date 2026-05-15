using Artha.Api.Dtos;
using Artha.Api.Drive;
using Artha.Core.Drive;
using Artha.Drive;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Artha.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/settings")]
public sealed class SettingsController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;

    public SettingsController(IDriveClientFactory driveFactory, AppDataBootstrapper bootstrapper)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
    }

    [HttpGet]
    public async Task<ActionResult<SettingsDto>> Get(CancellationToken cancellationToken)
    {
        var profile = User.ToProfile();
        var drive = await _driveFactory.CreateForUserAsync(profile.GoogleUserId, cancellationToken);
        await _bootstrapper.EnsureInitializedAsync(profile.GoogleUserId, drive, profile, cancellationToken);

        var repo = new AppDataRepository<SettingsDocument>(drive);
        var settings = await repo.ReadAsync(DriveFileNames.Settings, cancellationToken);

        var dto = settings is null
            ? new SettingsDto("USD", FirstRunCompleted: false, Locale: profile.Locale)
            : new SettingsDto(settings.Document.Currency, settings.Document.FirstRunCompleted, settings.Document.Locale);

        return Ok(dto);
    }

    [HttpPut]
    public async Task<ActionResult<SettingsDto>> Put(
        [FromBody] SettingsUpdateRequest request,
        CancellationToken cancellationToken)
    {
        var currency = request.Currency?.ToUpperInvariant() ?? string.Empty;
        if (!SupportedCurrencies.IsSupported(currency))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Unsupported currency",
                Detail = $"Currency '{request.Currency}' is not in the supported list: {string.Join(", ", SupportedCurrencies.All)}",
                Status = StatusCodes.Status400BadRequest,
            });
        }

        var profile = User.ToProfile();
        var drive = await _driveFactory.CreateForUserAsync(profile.GoogleUserId, cancellationToken);
        await _bootstrapper.EnsureInitializedAsync(profile.GoogleUserId, drive, profile, cancellationToken);

        var repo = new AppDataRepository<SettingsDocument>(drive);
        var existing = await repo.ReadAsync(DriveFileNames.Settings, cancellationToken);

        var updated = (existing?.Document ?? new SettingsDocument(SchemaVersions.Current, "USD", false, profile.Locale))
            with { Currency = currency, FirstRunCompleted = true };

        await repo.WriteAsync(DriveFileNames.Settings, updated, existing?.ETag, cancellationToken);

        return Ok(new SettingsDto(updated.Currency, updated.FirstRunCompleted, updated.Locale));
    }
}
