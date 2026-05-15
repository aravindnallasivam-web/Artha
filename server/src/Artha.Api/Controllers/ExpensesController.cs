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
[Route("api/expenses")]
public sealed class ExpensesController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;
    private readonly ILogger<ExpensesController> _logger;

    public ExpensesController(
        IDriveClientFactory driveFactory,
        AppDataBootstrapper bootstrapper,
        ILogger<ExpensesController> logger)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<ExpenseListResponse>> List(
        [FromQuery] string? from,
        [FromQuery] string? to,
        CancellationToken cancellationToken)
    {
        var now = DateOnly.FromDateTime(DateTime.UtcNow);
        var fromMonth = string.IsNullOrEmpty(from)
            ? YearMonth.From(now)
            : ParseYearMonth(from) ?? YearMonth.From(now);
        var toMonth = string.IsNullOrEmpty(to)
            ? YearMonth.From(now)
            : ParseYearMonth(to) ?? YearMonth.From(now);
        if (fromMonth.CompareTo(toMonth) > 0)
        {
            (fromMonth, toMonth) = (toMonth, fromMonth);
        }

        var ctx = await OpenAsync(cancellationToken);

        var manifestDoc = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
        var manifest = manifestDoc?.Document
            ?? new Manifest(SchemaVersions.Current, Array.Empty<string>(), DateTimeOffset.UtcNow);

        var shardNames = ExpenseShardOps.ShardsInRange(manifest, fromMonth, toMonth);
        var allItems = new List<Expense>();
        foreach (var shardName in shardNames)
        {
            var shard = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
            if (shard is not null)
            {
                allItems.AddRange(shard.Document.Items);
            }
        }

        var settings = await ctx.SettingsRepo.ReadAsync(DriveFileNames.Settings, cancellationToken);
        var currency = settings?.Document.Currency ?? "USD";

        var dtos = allItems
            .OrderByDescending(e => e.Date)
            .ThenByDescending(e => e.CreatedAt)
            .Select(ToDto)
            .ToList();

        return Ok(new ExpenseListResponse(dtos, currency));
    }

    [HttpPost]
    public async Task<ActionResult<ExpenseDto>> Create(
        [FromBody] ExpenseCreateRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(Problem400("Amount must be greater than zero."));
        }
        if (string.IsNullOrWhiteSpace(request.CategoryId))
        {
            return BadRequest(Problem400("CategoryId is required."));
        }

        var ctx = await OpenAsync(cancellationToken);

        var settings = await ctx.SettingsRepo.ReadAsync(DriveFileNames.Settings, cancellationToken);
        var currency = settings?.Document.Currency ?? "USD";

        // Validate category exists & is not archived.
        var categories = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var category = categories?.Document.Items.FirstOrDefault(c => c.Id == request.CategoryId);
        if (category is null || category.Archived)
        {
            return BadRequest(Problem400($"Category '{request.CategoryId}' does not exist or is archived."));
        }

        var now = DateTimeOffset.UtcNow;
        var expense = new Expense(
            Id: $"exp-{Guid.NewGuid():N}",
            Date: request.Date,
            Amount: request.Amount,
            Currency: currency,
            CategoryId: request.CategoryId,
            Note: string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            CreatedAt: now,
            UpdatedAt: now);

        await AppendToShardAsync(ctx, expense, cancellationToken);

        return CreatedAtAction(nameof(List), new { id = expense.Id }, ToDto(expense));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<ExpenseDto>> Update(
        string id,
        [FromBody] ExpenseUpdateRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Amount <= 0)
        {
            return BadRequest(Problem400("Amount must be greater than zero."));
        }

        var ctx = await OpenAsync(cancellationToken);
        var manifest = await RequireManifest(ctx, cancellationToken);

        var located = await FindByIdAsync(ctx, manifest, id, cancellationToken);
        if (located is null)
        {
            return NotFound();
        }

        var (oldShardName, oldShardDoc, expense) = located.Value;
        var oldMonth = YearMonth.From(expense.Date);
        var newMonth = YearMonth.From(request.Date);

        var updated = expense with
        {
            Date = request.Date,
            Amount = request.Amount,
            CategoryId = request.CategoryId,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        if (oldMonth.Equals(newMonth))
        {
            // Mutate in place.
            var nextItems = oldShardDoc.Document.Items.Select(e => e.Id == id ? updated : e).ToArray();
            await ctx.ExpenseRepo.WriteAsync(
                oldShardName,
                new ExpenseShard(SchemaVersions.Current, nextItems),
                oldShardDoc.ETag,
                cancellationToken);
        }
        else
        {
            // Cross-month move: remove from old shard, insert into new shard, manifest update.
            var trimmed = oldShardDoc.Document.Items.Where(e => e.Id != id).ToArray();
            await ctx.ExpenseRepo.WriteAsync(
                oldShardName,
                new ExpenseShard(SchemaVersions.Current, trimmed),
                oldShardDoc.ETag,
                cancellationToken);

            await AppendToShardAsync(ctx, updated, cancellationToken);
        }

        return Ok(ToDto(updated));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var ctx = await OpenAsync(cancellationToken);
        var manifest = await RequireManifest(ctx, cancellationToken);

        var located = await FindByIdAsync(ctx, manifest, id, cancellationToken);
        if (located is null)
        {
            return NotFound();
        }

        var (shardName, shardDoc, _) = located.Value;
        var trimmed = shardDoc.Document.Items.Where(e => e.Id != id).ToArray();
        await ctx.ExpenseRepo.WriteAsync(
            shardName,
            new ExpenseShard(SchemaVersions.Current, trimmed),
            shardDoc.ETag,
            cancellationToken);

        return NoContent();
    }

    /// <summary>
    /// Append an expense to its month's shard, creating the shard + manifest
    /// entry on first use. Retries once on transient conflict (the manifest
    /// or shard advanced between read and write).
    /// </summary>
    private static async Task AppendToShardAsync(Context ctx, Expense expense, CancellationToken cancellationToken)
    {
        var month = YearMonth.From(expense.Date);
        var shardName = DriveFileNames.ShardFor(month);

        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                var shardDoc = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
                var items = shardDoc?.Document.Items.Append(expense).ToArray()
                    ?? new[] { expense };

                await ctx.ExpenseRepo.WriteAsync(
                    shardName,
                    new ExpenseShard(SchemaVersions.Current, items),
                    shardDoc?.ETag,
                    cancellationToken);

                // Ensure manifest lists this shard.
                var manifestDoc = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
                var manifest = manifestDoc?.Document
                    ?? new Manifest(SchemaVersions.Current, Array.Empty<string>(), DateTimeOffset.UtcNow);
                if (!manifest.Shards.Contains(month.ToString()))
                {
                    var nextShards = manifest.Shards.Append(month.ToString())
                        .OrderBy(s => s)
                        .ToArray();
                    await ctx.ManifestRepo.WriteAsync(
                        DriveFileNames.Manifest,
                        manifest with { Shards = nextShards },
                        manifestDoc?.ETag,
                        cancellationToken);
                }
                return;
            }
            catch (DriveConflictException) when (attempt == 0)
            {
                // Re-read and retry once for append (idempotent because the expense Id is fresh).
            }
        }
    }

    private static async Task<(string ShardName, RepositoryDocument<ExpenseShard> ShardDoc, Expense Expense)?>
        FindByIdAsync(Context ctx, Manifest manifest, string expenseId, CancellationToken cancellationToken)
    {
        foreach (var (_, shardName) in ExpenseShardOps.ShardsNewestFirst(manifest))
        {
            var shardDoc = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
            if (shardDoc is null) continue;
            var hit = shardDoc.Document.Items.FirstOrDefault(e => e.Id == expenseId);
            if (hit is not null)
            {
                return (shardName, shardDoc, hit);
            }
        }
        return null;
    }

    private static async Task<Manifest> RequireManifest(Context ctx, CancellationToken cancellationToken)
    {
        var doc = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
        return doc?.Document ?? new Manifest(SchemaVersions.Current, Array.Empty<string>(), DateTimeOffset.UtcNow);
    }

    private static YearMonth? ParseYearMonth(string raw)
    {
        try { return YearMonth.Parse(raw); }
        catch (FormatException) { return null; }
    }

    private static ExpenseDto ToDto(Expense e) => new(
        Id: e.Id,
        Date: e.Date,
        Amount: e.Amount,
        Currency: e.Currency,
        CategoryId: e.CategoryId,
        Note: e.Note,
        CreatedAt: e.CreatedAt,
        UpdatedAt: e.UpdatedAt);

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
            new AppDataRepository<Manifest>(drive),
            new AppDataRepository<ExpenseShard>(drive),
            new AppDataRepository<CategoryList>(drive),
            new AppDataRepository<SettingsDocument>(drive));
    }

    private sealed record Context(
        IDriveClient Drive,
        AppDataRepository<Manifest> ManifestRepo,
        AppDataRepository<ExpenseShard> ExpenseRepo,
        AppDataRepository<CategoryList> CategoryRepo,
        AppDataRepository<SettingsDocument> SettingsRepo);
}
