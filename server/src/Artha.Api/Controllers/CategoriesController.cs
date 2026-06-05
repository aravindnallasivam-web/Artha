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
            Archived: false,
            ExcludeFromReports: request.ExcludeFromReports);

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
            ExcludeFromReports = request.ExcludeFromReports,
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

    /// <summary>
    /// Merge one or more source categories into a target: every expense that
    /// references a source category is reassigned to the target, then the source
    /// categories are archived.
    /// </summary>
    [HttpPost("merge")]
    public async Task<ActionResult<IReadOnlyList<CategoryDto>>> Merge(
        [FromBody] CategoryMergeRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.TargetId))
        {
            return BadRequest(Problem400("A target category is required."));
        }

        var sourceIds = (request.SourceIds ?? Array.Empty<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id) && id != request.TargetId)
            .Distinct()
            .ToHashSet();
        if (sourceIds.Count == 0)
        {
            return BadRequest(Problem400("Select at least one other category to merge in."));
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Category>()).ToList();

        var target = list.FirstOrDefault(c => c.Id == request.TargetId);
        if (target is null)
        {
            return NotFound();
        }
        if (target.Archived)
        {
            return BadRequest(Problem400("Cannot merge into an archived category."));
        }
        if (sourceIds.Any(id => list.All(c => c.Id != id)))
        {
            return NotFound();
        }

        // 1. Reassign expenses across every shard, one read+write per shard.
        var manifest = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
        if (manifest is not null)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var (_, shardName) in ExpenseShardOps.ShardsNewestFirst(manifest.Document))
            {
                await ReassignShardAsync(ctx, shardName, sourceIds, request.TargetId, now, cancellationToken);
            }
        }

        // 2. Archive the merged-away source categories.
        for (var i = 0; i < list.Count; i++)
        {
            if (sourceIds.Contains(list[i].Id) && !list[i].Archived)
            {
                list[i] = list[i] with { Archived = true };
            }
        }
        await ctx.CategoryRepo.WriteAsync(
            DriveFileNames.Categories,
            new CategoryList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        var active = list.Where(c => !c.Archived).Select(ToDto).ToList();
        return Ok(active);
    }

    private static async Task ReassignShardAsync(
        Context ctx,
        string shardName,
        IReadOnlySet<string> sourceIds,
        string targetId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var shard = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
            if (shard is null)
            {
                return;
            }

            var items = shard.Document.Items;
            if (!items.Any(e => sourceIds.Contains(e.CategoryId)))
            {
                return; // Nothing in this shard references a source category.
            }

            var updated = items
                .Select(e => sourceIds.Contains(e.CategoryId)
                    ? e with { CategoryId = targetId, UpdatedAt = now }
                    : e)
                .ToArray();

            try
            {
                await ctx.ExpenseRepo.WriteAsync(
                    shardName,
                    new ExpenseShard(SchemaVersions.Current, updated),
                    shard.ETag,
                    cancellationToken);
                return;
            }
            catch (DriveConflictException) when (attempt == 0)
            {
                // Shard advanced between read and write — re-read and retry once.
            }
        }
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
        new(c.Id, c.Name, c.Color, c.Icon, c.Archived, c.ExcludeFromReports);

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
