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
[Route("api/reports")]
public sealed class ReportsController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;

    public ReportsController(IDriveClientFactory driveFactory, AppDataBootstrapper bootstrapper)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
    }

    [HttpGet("monthly")]
    public async Task<ActionResult<MonthlyReportDto>> Monthly(
        [FromQuery] int? year,
        [FromQuery] int? month,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var y = year ?? now.Year;
        var m = month ?? now.Month;
        if (m is < 1 or > 12)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid month",
                Detail = "Month must be 1-12.",
                Status = StatusCodes.Status400BadRequest,
            });
        }

        var ctx = await OpenAsync(cancellationToken);
        var manifest = await ReadManifest(ctx, cancellationToken);
        var settings = await ctx.SettingsRepo.ReadAsync(DriveFileNames.Settings, cancellationToken);
        var currency = settings?.Document.Currency ?? "USD";

        var categoriesById = await ReadCategoriesById(ctx, cancellationToken);

        var target = new YearMonth(y, m);
        var shardNames = ExpenseShardOps.ShardsInRange(manifest, target, target);
        var allItems = new List<Expense>();
        foreach (var shardName in shardNames)
        {
            var shard = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
            if (shard is not null)
            {
                allItems.AddRange(shard.Document.Items);
            }
        }

        var byCategory = allItems
            .GroupBy(e => e.CategoryId)
            .Select(g => new CategoryBreakdownDto(
                CategoryId: g.Key,
                CategoryName: categoriesById.TryGetValue(g.Key, out var c) ? c.Name : "(Unknown)",
                Total: g.Sum(e => e.Amount),
                Count: g.Count()))
            .OrderByDescending(b => b.Total)
            .ToList();

        // Planned (predefined) monthly expenses are budget figures, not
        // transactions — the same set applies to every month, so we surface
        // their total alongside the actual spend for a planned-vs-actual view.
        var plannedDoc = await ctx.PlannedRepo.ReadAsync(DriveFileNames.PlannedExpenses, cancellationToken);
        var planned = (plannedDoc?.Document.Items ?? Array.Empty<PlannedExpense>())
            .Where(p => !p.Archived)
            .ToList();

        return Ok(new MonthlyReportDto(
            Year: y,
            Month: m,
            Currency: currency,
            Total: allItems.Sum(e => e.Amount),
            Count: allItems.Count,
            PlannedTotal: planned.Sum(p => p.Amount),
            PlannedCount: planned.Count,
            ByCategory: byCategory));
    }

    [HttpGet("yearly")]
    public async Task<ActionResult<YearlyReportDto>> Yearly(
        [FromQuery] int? year,
        CancellationToken cancellationToken)
    {
        var y = year ?? DateTime.UtcNow.Year;

        var ctx = await OpenAsync(cancellationToken);
        var manifest = await ReadManifest(ctx, cancellationToken);
        var settings = await ctx.SettingsRepo.ReadAsync(DriveFileNames.Settings, cancellationToken);
        var currency = settings?.Document.Currency ?? "USD";

        var categoriesById = await ReadCategoriesById(ctx, cancellationToken);

        var shardNames = ExpenseShardOps.ShardsInRange(manifest, new YearMonth(y, 1), new YearMonth(y, 12));

        // Parallel reads — Drive lets us pipeline these.
        var shardReads = await Task.WhenAll(shardNames.Select(name =>
            ctx.ExpenseRepo.ReadAsync(name, cancellationToken)));

        var monthSummaries = new Dictionary<int, (decimal Total, int Count)>();
        var byCategoryAccum = new Dictionary<string, (decimal Total, int Count)>();

        foreach (var shard in shardReads)
        {
            if (shard is null) continue;
            foreach (var expense in shard.Document.Items)
            {
                var prevMonth = monthSummaries.GetValueOrDefault(expense.Date.Month);
                monthSummaries[expense.Date.Month] = (prevMonth.Total + expense.Amount, prevMonth.Count + 1);

                var prevCat = byCategoryAccum.GetValueOrDefault(expense.CategoryId);
                byCategoryAccum[expense.CategoryId] = (prevCat.Total + expense.Amount, prevCat.Count + 1);
            }
        }

        // Always return all 12 months for chart-friendly output.
        var months = Enumerable.Range(1, 12)
            .Select(m =>
            {
                var summary = monthSummaries.GetValueOrDefault(m);
                return new MonthSummaryDto(m, summary.Total, summary.Count);
            })
            .ToList();

        var byCategory = byCategoryAccum
            .Select(kv => new CategoryBreakdownDto(
                CategoryId: kv.Key,
                CategoryName: categoriesById.TryGetValue(kv.Key, out var c) ? c.Name : "(Unknown)",
                Total: kv.Value.Total,
                Count: kv.Value.Count))
            .OrderByDescending(b => b.Total)
            .ToList();

        return Ok(new YearlyReportDto(
            Year: y,
            Currency: currency,
            YearTotal: months.Sum(m => m.Total),
            YearCount: months.Sum(m => m.Count),
            Months: months,
            ByCategory: byCategory));
    }

    private static async Task<Manifest> ReadManifest(Context ctx, CancellationToken cancellationToken)
    {
        var doc = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
        return doc?.Document ?? new Manifest(SchemaVersions.Current, Array.Empty<string>(), DateTimeOffset.UtcNow);
    }

    private static async Task<Dictionary<string, Category>> ReadCategoriesById(Context ctx, CancellationToken cancellationToken)
    {
        var doc = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        return (doc?.Document.Items ?? Array.Empty<Category>()).ToDictionary(c => c.Id);
    }

    private async Task<Context> OpenAsync(CancellationToken cancellationToken)
    {
        var profile = User.ToProfile();
        var drive = await _driveFactory.CreateForUserAsync(profile.GoogleUserId, cancellationToken);
        await _bootstrapper.EnsureInitializedAsync(profile.GoogleUserId, drive, profile, cancellationToken);

        return new Context(
            new AppDataRepository<Manifest>(drive),
            new AppDataRepository<ExpenseShard>(drive),
            new AppDataRepository<CategoryList>(drive),
            new AppDataRepository<SettingsDocument>(drive),
            new AppDataRepository<PlannedExpenseList>(drive));
    }

    private sealed record Context(
        AppDataRepository<Manifest> ManifestRepo,
        AppDataRepository<ExpenseShard> ExpenseRepo,
        AppDataRepository<CategoryList> CategoryRepo,
        AppDataRepository<SettingsDocument> SettingsRepo,
        AppDataRepository<PlannedExpenseList> PlannedRepo);
}
