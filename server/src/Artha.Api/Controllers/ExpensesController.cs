using System.Globalization;
using Artha.Api.Dtos;
using Artha.Api.Drive;
using Artha.Api.Import;
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
        var accountId = string.IsNullOrWhiteSpace(request.AccountId)
            ? DriveFileNames.DefaultAccountId
            : request.AccountId;

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

        // Validate account exists & is not archived.
        var accounts = await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken);
        var account = accounts?.Document.Items.FirstOrDefault(a => a.Id == accountId);
        if (account is null || account.Archived)
        {
            return BadRequest(Problem400($"Account '{accountId}' does not exist or is archived."));
        }

        var now = DateTimeOffset.UtcNow;
        var expense = new Expense(
            Id: $"exp-{Guid.NewGuid():N}",
            Date: request.Date,
            Amount: request.Amount,
            Currency: currency,
            CategoryId: request.CategoryId,
            AccountId: accountId,
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

        var accountId = string.IsNullOrWhiteSpace(request.AccountId)
            ? DriveFileNames.DefaultAccountId
            : request.AccountId;

        var updated = expense with
        {
            Date = request.Date,
            Amount = request.Amount,
            CategoryId = request.CategoryId,
            AccountId = accountId,
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
    /// Parse an uploaded .xlsx/.csv file and return a validated preview. Writes
    /// nothing — the client reviews the rows (and which categories/accounts
    /// would be auto-created) and then POSTs the valid rows to <see cref="ImportConfirm"/>.
    /// </summary>
    [HttpPost("import/preview")]
    [RequestSizeLimit(5_000_000)]
    public async Task<ActionResult<ImportPreviewResponse>> ImportPreview(
        IFormFile? file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(Problem400("No file was uploaded."));
        }
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".xlsx" or ".csv"))
        {
            return BadRequest(Problem400("Unsupported file type. Upload a .xlsx or .csv file."));
        }

        IReadOnlyList<RawImportRow> raw;
        try
        {
            // ClosedXML needs a seekable stream, so buffer the upload to memory.
            using var buffer = new MemoryStream();
            await using (var upload = file.OpenReadStream())
            {
                await upload.CopyToAsync(buffer, cancellationToken);
            }
            buffer.Position = 0;
            raw = ExpenseImportParser.Parse(buffer, file.FileName);
        }
        catch (ImportFormatException ex)
        {
            return BadRequest(Problem400(ex.Message));
        }

        var ctx = await OpenAsync(cancellationToken);
        var settings = await ctx.SettingsRepo.ReadAsync(DriveFileNames.Settings, cancellationToken);
        var currency = settings?.Document.Currency ?? "USD";
        var categories = (await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken))
            ?.Document.Items ?? Array.Empty<Category>();
        var accounts = (await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken))
            ?.Document.Items ?? Array.Empty<Account>();

        var existingCats = new HashSet<string>(
            categories.Where(c => !c.Archived).Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
        var existingAccts = new HashSet<string>(
            accounts.Where(a => !a.Archived).Select(a => a.Name), StringComparer.OrdinalIgnoreCase);

        var rows = new List<ImportPreviewRow>(raw.Count);
        var newCats = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var newAccts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var r in raw)
        {
            var errors = new List<string>();

            DateOnly? date = null;
            if (string.IsNullOrWhiteSpace(r.Date))
            {
                errors.Add("Date is required.");
            }
            else if ((date = TryParseDate(r.Date)) is null)
            {
                errors.Add($"Unrecognised date '{r.Date}' (use YYYY-MM-DD).");
            }

            decimal? amount = null;
            if (string.IsNullOrWhiteSpace(r.Amount))
            {
                errors.Add("Amount is required.");
            }
            else if ((amount = TryParseAmount(r.Amount)) is null)
            {
                errors.Add($"Unrecognised amount '{r.Amount}'.");
            }
            else if (amount <= 0)
            {
                errors.Add("Amount must be greater than zero.");
            }

            if (string.IsNullOrWhiteSpace(r.Category))
            {
                errors.Add("Category is required.");
            }

            var valid = errors.Count == 0;
            if (valid)
            {
                if (!existingCats.Contains(r.Category!))
                {
                    newCats.Add(r.Category!.Trim());
                }
                if (!string.IsNullOrWhiteSpace(r.Account) && !existingAccts.Contains(r.Account))
                {
                    newAccts.Add(r.Account.Trim());
                }
            }

            rows.Add(new ImportPreviewRow(
                r.RowNumber, date, amount, r.Category, r.Account, r.Note, valid, errors));
        }

        return Ok(new ImportPreviewResponse(
            rows,
            rows.Count(x => x.Valid),
            rows.Count(x => !x.Valid),
            newCats.OrderBy(x => x).ToArray(),
            newAccts.OrderBy(x => x).ToArray(),
            currency));
    }

    /// <summary>
    /// Persist confirmed import rows: auto-create any categories/accounts whose
    /// names don't yet exist, then batch-append the expenses into their monthly
    /// shards.
    /// </summary>
    [HttpPost("import")]
    public async Task<ActionResult<ImportResultResponse>> ImportConfirm(
        [FromBody] ImportConfirmRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Rows is null || request.Rows.Count == 0)
        {
            return BadRequest(Problem400("No rows to import."));
        }

        var ctx = await OpenAsync(cancellationToken);
        var settings = await ctx.SettingsRepo.ReadAsync(DriveFileNames.Settings, cancellationToken);
        var currency = settings?.Document.Currency ?? "USD";

        var catDoc = await ctx.CategoryRepo.ReadAsync(DriveFileNames.Categories, cancellationToken);
        var catList = (catDoc?.Document.Items ?? Array.Empty<Category>()).ToList();
        var acctDoc = await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken);
        var acctList = (acctDoc?.Document.Items ?? Array.Empty<Account>()).ToList();

        var catByName = catList.Where(c => !c.Archived)
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        var acctByName = acctList.Where(a => !a.Archived)
            .GroupBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        // Defensive re-validation: never trust the client to have filtered.
        var validRows = request.Rows
            .Where(r => r.Amount > 0 && !string.IsNullOrWhiteSpace(r.Category))
            .ToList();

        var createdCats = new List<string>();
        foreach (var name in validRows.Select(r => r.Category.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!catByName.ContainsKey(name))
            {
                var created = new Category($"cat-{Guid.NewGuid():N}", name, null, null, false);
                catList.Add(created);
                catByName[name] = created.Id;
                createdCats.Add(name);
            }
        }

        var createdAccts = new List<string>();
        foreach (var name in validRows.Where(r => !string.IsNullOrWhiteSpace(r.Account))
            .Select(r => r.Account!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!acctByName.ContainsKey(name))
            {
                var created = new Account($"acc-{Guid.NewGuid():N}", name, "cash", currency, 0m, null, null, false);
                acctList.Add(created);
                acctByName[name] = created.Id;
                createdAccts.Add(name);
            }
        }

        if (createdCats.Count > 0)
        {
            await ctx.CategoryRepo.WriteAsync(
                DriveFileNames.Categories,
                new CategoryList(SchemaVersions.Current, catList),
                catDoc?.ETag,
                cancellationToken);
        }
        if (createdAccts.Count > 0)
        {
            await ctx.AccountRepo.WriteAsync(
                DriveFileNames.Accounts,
                new AccountList(SchemaVersions.Current, acctList),
                acctDoc?.ETag,
                cancellationToken);
        }

        var now = DateTimeOffset.UtcNow;
        var expenses = validRows.Select(r => new Expense(
            Id: $"exp-{Guid.NewGuid():N}",
            Date: r.Date,
            Amount: r.Amount,
            Currency: currency,
            CategoryId: catByName[r.Category.Trim()],
            AccountId: string.IsNullOrWhiteSpace(r.Account)
                ? DriveFileNames.DefaultAccountId
                : acctByName[r.Account.Trim()],
            Note: string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim(),
            CreatedAt: now,
            UpdatedAt: now)).ToList();

        await AppendManyToShardsAsync(ctx, expenses, cancellationToken);

        return Ok(new ImportResultResponse(expenses.Count, createdCats, createdAccts));
    }

    private static readonly string[] DateFormats =
    [
        "yyyy-MM-dd", "yyyy/MM/dd", "MM/dd/yyyy", "M/d/yyyy",
        "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "yyyy.MM.dd",
    ];

    private static DateOnly? TryParseDate(string raw)
    {
        if (DateOnly.TryParseExact(raw, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
        {
            return d;
        }
        if (DateOnly.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
        {
            return d;
        }
        return null;
    }

    private static decimal? TryParseAmount(string raw)
    {
        // Strip currency symbols / thousands separators, keep digits, '.', '-'.
        var cleaned = new string(raw.Where(ch => char.IsDigit(ch) || ch is '.' or '-').ToArray());
        return decimal.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out var v)
            ? v
            : null;
    }

    /// <summary>
    /// Append many expenses at once, grouping by month so each shard (and the
    /// manifest) is read and written only once. Used by the import flow.
    /// </summary>
    private static async Task AppendManyToShardsAsync(
        Context ctx, IReadOnlyList<Expense> expenses, CancellationToken cancellationToken)
    {
        if (expenses.Count == 0)
        {
            return;
        }

        var manifestDoc = await ctx.ManifestRepo.ReadAsync(DriveFileNames.Manifest, cancellationToken);
        var manifest = manifestDoc?.Document
            ?? new Manifest(SchemaVersions.Current, Array.Empty<string>(), DateTimeOffset.UtcNow);
        var shards = manifest.Shards.ToList();
        var manifestChanged = false;

        foreach (var group in expenses.GroupBy(e => YearMonth.From(e.Date)))
        {
            var month = group.Key;
            var shardName = DriveFileNames.ShardFor(month);
            var shardDoc = await ctx.ExpenseRepo.ReadAsync(shardName, cancellationToken);
            var items = (shardDoc?.Document.Items ?? Array.Empty<Expense>())
                .Concat(group)
                .ToArray();
            await ctx.ExpenseRepo.WriteAsync(
                shardName,
                new ExpenseShard(SchemaVersions.Current, items),
                shardDoc?.ETag,
                cancellationToken);

            if (!shards.Contains(month.ToString()))
            {
                shards.Add(month.ToString());
                manifestChanged = true;
            }
        }

        if (manifestChanged)
        {
            await ctx.ManifestRepo.WriteAsync(
                DriveFileNames.Manifest,
                manifest with { Shards = shards.OrderBy(s => s).ToArray() },
                manifestDoc?.ETag,
                cancellationToken);
        }
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
        // Legacy expenses written before M5 didn't have AccountId; surface
        // them as belonging to the well-known default account.
        AccountId: string.IsNullOrEmpty(e.AccountId) ? DriveFileNames.DefaultAccountId : e.AccountId,
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
            new AppDataRepository<AccountList>(drive),
            new AppDataRepository<SettingsDocument>(drive));
    }

    private sealed record Context(
        IDriveClient Drive,
        AppDataRepository<Manifest> ManifestRepo,
        AppDataRepository<ExpenseShard> ExpenseRepo,
        AppDataRepository<CategoryList> CategoryRepo,
        AppDataRepository<AccountList> AccountRepo,
        AppDataRepository<SettingsDocument> SettingsRepo);
}
