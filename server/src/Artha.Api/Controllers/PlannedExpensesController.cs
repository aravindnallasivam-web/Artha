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
[Route("api/planned-expenses")]
public sealed class PlannedExpensesController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;

    public PlannedExpensesController(IDriveClientFactory driveFactory, AppDataBootstrapper bootstrapper)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<PlannedExpenseDto>>> List(
        [FromQuery] bool includeArchived = false,
        CancellationToken cancellationToken = default)
    {
        var ctx = await OpenAsync(cancellationToken);
        var doc = await ctx.PlannedRepo.ReadAsync(DriveFileNames.PlannedExpenses, cancellationToken);
        var items = (doc?.Document.Items ?? Array.Empty<PlannedExpense>())
            .Where(p => includeArchived || !p.Archived)
            .Select(ToDto)
            .ToList();
        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<PlannedExpenseDto>> Create(
        [FromBody] PlannedExpenseUpsertRequest request,
        CancellationToken cancellationToken)
    {
        var ctx = await OpenAsync(cancellationToken);
        var error = await Validate(ctx, request, cancellationToken);
        if (error is not null)
        {
            return BadRequest(Problem400(error));
        }

        var existing = await ctx.PlannedRepo.ReadAsync(DriveFileNames.PlannedExpenses, cancellationToken);
        var list = existing?.Document.Items ?? Array.Empty<PlannedExpense>();

        if (list.Any(p => !p.Archived && p.Name.Equals(request.Name.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"A planned expense named '{request.Name.Trim()}' already exists."));
        }

        var created = new PlannedExpense(
            Id: $"plan-{Guid.NewGuid():N}",
            Name: request.Name.Trim(),
            Amount: request.Amount,
            CategoryId: string.IsNullOrWhiteSpace(request.CategoryId) ? null : request.CategoryId,
            DayOfMonth: request.DayOfMonth,
            Archived: false,
            Cycle: NormalizeCycle(request.Cycle));

        var next = new PlannedExpenseList(SchemaVersions.Current, list.Append(created).ToArray());
        await ctx.PlannedRepo.WriteAsync(DriveFileNames.PlannedExpenses, next, existing?.ETag, cancellationToken);

        return CreatedAtAction(nameof(List), ToDto(created));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<PlannedExpenseDto>> Update(
        string id,
        [FromBody] PlannedExpenseUpsertRequest request,
        CancellationToken cancellationToken)
    {
        var ctx = await OpenAsync(cancellationToken);
        var error = await Validate(ctx, request, cancellationToken);
        if (error is not null)
        {
            return BadRequest(Problem400(error));
        }

        var existing = await ctx.PlannedRepo.ReadAsync(DriveFileNames.PlannedExpenses, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<PlannedExpense>()).ToList();
        var idx = list.FindIndex(p => p.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        if (list.Any(p => p.Id != id && !p.Archived &&
            p.Name.Equals(request.Name.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"A planned expense named '{request.Name.Trim()}' already exists."));
        }

        list[idx] = list[idx] with
        {
            Name = request.Name.Trim(),
            Amount = request.Amount,
            CategoryId = string.IsNullOrWhiteSpace(request.CategoryId) ? null : request.CategoryId,
            DayOfMonth = request.DayOfMonth,
            Cycle = NormalizeCycle(request.Cycle),
        };

        await ctx.PlannedRepo.WriteAsync(
            DriveFileNames.PlannedExpenses,
            new PlannedExpenseList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return Ok(ToDto(list[idx]));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.PlannedRepo.ReadAsync(DriveFileNames.PlannedExpenses, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<PlannedExpense>()).ToList();
        var idx = list.FindIndex(p => p.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        // Soft delete: mark Archived = true, consistent with categories/accounts.
        list[idx] = list[idx] with { Archived = true };
        await ctx.PlannedRepo.WriteAsync(
            DriveFileNames.PlannedExpenses,
            new PlannedExpenseList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return NoContent();
    }

    private static async Task<string?> Validate(
        Context ctx,
        PlannedExpenseUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return "Name is required.";
        }
        if (request.Amount <= 0)
        {
            return "Amount must be greater than zero.";
        }
        if (request.DayOfMonth is < 1 or > 31)
        {
            return "Day of month must be between 1 and 31.";
        }
        if (!string.IsNullOrWhiteSpace(request.CategoryId))
        {
            var categories = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
            var category = (categories?.Document.Items ?? Array.Empty<Category>())
                .FirstOrDefault(c => c.Id == request.CategoryId);
            if (category is null || category.Archived)
            {
                return "Selected category does not exist or is archived.";
            }
        }
        return null;
    }

    private static PlannedExpenseDto ToDto(PlannedExpense p) =>
        new(p.Id, p.Name, p.Amount, p.CategoryId, p.DayOfMonth, p.Archived, NormalizeCycle(p.Cycle));

    /// <summary>Only "monthly" or "yearly" are valid; anything else means monthly.</summary>
    private static string NormalizeCycle(string? cycle) =>
        string.Equals(cycle, "yearly", StringComparison.OrdinalIgnoreCase) ? "yearly" : "monthly";

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
            new AppDataRepository<PlannedExpenseList>(drive),
            new AppDataRepository<CategoryList>(drive));
    }

    private sealed record Context(
        IDriveClient Drive,
        AppDataRepository<PlannedExpenseList> PlannedRepo,
        AppDataRepository<CategoryList> CategoryRepo);
}
