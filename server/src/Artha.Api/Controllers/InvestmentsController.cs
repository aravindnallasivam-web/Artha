using Artha.Api.Dtos;
using Artha.Api.Drive;
using Artha.Core.Drive;
using Artha.Core.Models;
using Artha.Drive;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Artha.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/investments")]
public sealed class InvestmentsController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;

    public InvestmentsController(IDriveClientFactory driveFactory, AppDataBootstrapper bootstrapper)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<InvestmentDto>>> List(
        [FromQuery] bool includeArchived = false,
        CancellationToken cancellationToken = default)
    {
        var ctx = await OpenAsync(cancellationToken);
        var doc = await ctx.InvestmentRepo.ReadAsync(DriveFileNames.Investments, cancellationToken);
        var items = (doc?.Document.Items ?? Array.Empty<Investment>())
            .Where(i => includeArchived || !i.Archived)
            .Select(ToDto)
            .ToList();
        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<InvestmentDto>> Create(
        [FromBody] InvestmentUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (Validate(request) is { } problem)
        {
            return BadRequest(problem);
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.InvestmentRepo.ReadAsync(DriveFileNames.Investments, cancellationToken);
        var list = existing?.Document.Items ?? Array.Empty<Investment>();

        if (list.Any(i => !i.Archived && i.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"An investment named '{request.Name}' already exists."));
        }

        var now = DateTimeOffset.UtcNow;
        var created = new Investment(
            Id: $"inv-{Guid.NewGuid():N}",
            Name: request.Name.Trim(),
            Type: request.Type.Trim().ToLowerInvariant(),
            Currency: request.Currency.Trim().ToUpperInvariant(),
            InvestedAmount: request.InvestedAmount,
            CurrentValue: request.CurrentValue,
            InterestRate: request.InterestRate,
            InstallmentAmount: request.InstallmentAmount,
            StartDate: request.StartDate,
            MaturityDate: request.MaturityDate,
            Institution: Trimmed(request.Institution),
            PolicyOrAccountNumber: Trimmed(request.PolicyOrAccountNumber),
            Note: Trimmed(request.Note),
            Color: request.Color,
            Icon: request.Icon,
            CreatedAt: now,
            UpdatedAt: now,
            Archived: false);

        var next = new InvestmentList(SchemaVersions.Current, list.Append(created).ToArray());
        await ctx.InvestmentRepo.WriteAsync(DriveFileNames.Investments, next, existing?.ETag, cancellationToken);

        return CreatedAtAction(nameof(List), ToDto(created));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<InvestmentDto>> Update(
        string id,
        [FromBody] InvestmentUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (Validate(request) is { } problem)
        {
            return BadRequest(problem);
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.InvestmentRepo.ReadAsync(DriveFileNames.Investments, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Investment>()).ToList();
        var idx = list.FindIndex(i => i.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        if (list.Any(i => i.Id != id && !i.Archived &&
            i.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"An investment named '{request.Name}' already exists."));
        }

        list[idx] = list[idx] with
        {
            Name = request.Name.Trim(),
            Type = request.Type.Trim().ToLowerInvariant(),
            Currency = request.Currency.Trim().ToUpperInvariant(),
            InvestedAmount = request.InvestedAmount,
            CurrentValue = request.CurrentValue,
            InterestRate = request.InterestRate,
            InstallmentAmount = request.InstallmentAmount,
            StartDate = request.StartDate,
            MaturityDate = request.MaturityDate,
            Institution = Trimmed(request.Institution),
            PolicyOrAccountNumber = Trimmed(request.PolicyOrAccountNumber),
            Note = Trimmed(request.Note),
            Color = request.Color,
            Icon = request.Icon,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        await ctx.InvestmentRepo.WriteAsync(
            DriveFileNames.Investments,
            new InvestmentList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return Ok(ToDto(list[idx]));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.InvestmentRepo.ReadAsync(DriveFileNames.Investments, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Investment>()).ToList();
        var idx = list.FindIndex(i => i.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        // Soft delete: keep the row so it's still retrievable with includeArchived.
        list[idx] = list[idx] with { Archived = true, UpdatedAt = DateTimeOffset.UtcNow };
        await ctx.InvestmentRepo.WriteAsync(
            DriveFileNames.Investments,
            new InvestmentList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return NoContent();
    }

    private static ProblemDetails? Validate(InvestmentUpsertRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Problem400("Name is required.");
        }
        var type = request.Type?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(type) || !InvestmentTypes.All.Contains(type))
        {
            return Problem400(
                $"Type must be one of: {string.Join(", ", InvestmentTypes.All)}.");
        }
        if (string.IsNullOrWhiteSpace(request.Currency) || request.Currency.Length != 3)
        {
            return Problem400("Currency must be a 3-letter ISO code (e.g. USD).");
        }

        // Light per-type requirements — the rest of the fields stay optional.
        switch (type)
        {
            case InvestmentTypes.RecurringDeposit:
                if (request.InstallmentAmount is null or <= 0)
                {
                    return Problem400("A recurring deposit needs a monthly installment amount.");
                }
                if (request.InterestRate is null)
                {
                    return Problem400("A recurring deposit needs an interest rate.");
                }
                break;
            case InvestmentTypes.FixedDeposit:
                if (request.InterestRate is null)
                {
                    return Problem400("A fixed deposit needs an interest rate.");
                }
                break;
            case InvestmentTypes.InsurancePolicy:
                if (string.IsNullOrWhiteSpace(request.PolicyOrAccountNumber))
                {
                    return Problem400("An insurance policy needs a policy number.");
                }
                break;
        }

        return null;
    }

    private static string? Trimmed(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static InvestmentDto ToDto(Investment i) =>
        new(i.Id, i.Name, i.Type, i.Currency, i.InvestedAmount, i.CurrentValue,
            i.InterestRate, i.InstallmentAmount, i.StartDate, i.MaturityDate,
            i.Institution, i.PolicyOrAccountNumber, i.Note, i.Color, i.Icon, i.Archived);

    private static ProblemDetails Problem400(string detail) => new()
    {
        Title = "Bad request",
        Detail = detail,
        Status = StatusCodes.Status400BadRequest,
    };

    private async Task<Context> OpenAsync(CancellationToken cancellationToken)
    {
        var profile = User.ToProfile();
        var drive = await _driveFactory.CreateForUserAsync(profile.GoogleUserId, cancellationToken);
        await _bootstrapper.EnsureInitializedAsync(profile.GoogleUserId, drive, profile, cancellationToken);

        return new Context(
            drive,
            new AppDataRepository<InvestmentList>(drive));
    }

    private sealed record Context(
        IDriveClient Drive,
        AppDataRepository<InvestmentList> InvestmentRepo);
}
