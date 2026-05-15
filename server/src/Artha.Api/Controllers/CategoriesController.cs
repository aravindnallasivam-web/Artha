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
[Route("api/categories")]
public sealed class CategoriesController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;

    public CategoriesController(IDriveClientFactory driveFactory, AppDataBootstrapper bootstrapper)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CategoryDto>>> List(
        [FromQuery] bool includeArchived = false,
        CancellationToken cancellationToken = default)
    {
        var ctx = await OpenAsync(cancellationToken);
        var doc = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var items = (doc?.Document.Items ?? Array.Empty<Category>())
            .Where(c => includeArchived || !c.Archived)
            .Select(ToDto)
            .ToList();
        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<CategoryDto>> Create(
        [FromBody] CategoryUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(Problem400("Name is required."));
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var list = existing?.Document.Items ?? Array.Empty<Category>();

        if (list.Any(c => !c.Archived && c.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"A category named '{request.Name}' already exists."));
        }

        var created = new Category(
            Id: $"cat-{Guid.NewGuid():N}",
            Name: request.Name.Trim(),
            Color: request.Color,
            Icon: request.Icon,
            Archived: false);

        var next = new CategoryList(SchemaVersions.Current, list.Append(created).ToArray());
        await ctx.CategoryRepo.WriteAsync(DriveFileNames.Categories, next, existing?.ETag, cancellationToken);

        return CreatedAtAction(nameof(List), ToDto(created));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<CategoryDto>> Update(
        string id,
        [FromBody] CategoryUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(Problem400("Name is required."));
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Category>()).ToList();
        var idx = list.FindIndex(c => c.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        if (list.Any(c => c.Id != id && !c.Archived &&
            c.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"A category named '{request.Name}' already exists."));
        }

        list[idx] = list[idx] with
        {
            Name = request.Name.Trim(),
            Color = request.Color,
            Icon = request.Icon,
        };

        await ctx.CategoryRepo.WriteAsync(
            DriveFileNames.Categories,
            new CategoryList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return Ok(ToDto(list[idx]));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Category>()).ToList();
        var idx = list.FindIndex(c => c.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        if (await CategoryIsReferenced(ctx, id, cancellationToken))
        {
            return Conflict(new ProblemDetails
            {
                Type = "https://artha.example/problems/category-in-use",
                Title = "Category in use",
                Detail = "This category is referenced by one or more expenses. Archive it instead, or reassign those expenses first.",
                Status = StatusCodes.Status409Conflict,
            });
        }

        // Soft delete: mark Archived = true rather than removing the row, so
        // historical expense references stay resolvable.
        list[idx] = list[idx] with { Archived = true };
        await ctx.CategoryRepo.WriteAsync(
            DriveFileNames.Categories,
            new CategoryList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return NoContent();
    }

    private async Task<bool> CategoryIsReferenced(Context ctx, string categoryId, CancellationToken cancellationToken)
    {
        var manifest = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
        if (manifest is null)
        {
            return false;
        }
        foreach (var (_, shardName) in ExpenseShardOps.ShardsNewestFirst(manifest.Document))
        {
            var shard = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
            if (shard is null) continue;
            if (shard.Document.Items.Any(e => e.CategoryId == categoryId))
            {
                return true;
            }
        }
        return false;
    }

    private static CategoryDto ToDto(Category c) =>
        new(c.Id, c.Name, c.Color, c.Icon, c.Archived);

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
            new AppDataRepository<CategoryList>(drive),
            new AppDataRepository<Manifest>(drive),
            new AppDataRepository<ExpenseShard>(drive));
    }

    private sealed record Context(
        IDriveClient Drive,
        AppDataRepository<CategoryList> CategoryRepo,
        AppDataRepository<Manifest> ManifestRepo,
        AppDataRepository<ExpenseShard> ExpenseRepo);
}
