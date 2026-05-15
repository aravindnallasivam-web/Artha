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
[Route("api/accounts")]
public sealed class AccountsController : ControllerBase
{
    private readonly IDriveClientFactory _driveFactory;
    private readonly AppDataBootstrapper _bootstrapper;

    public AccountsController(IDriveClientFactory driveFactory, AppDataBootstrapper bootstrapper)
    {
        _driveFactory = driveFactory;
        _bootstrapper = bootstrapper;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AccountDto>>> List(
        [FromQuery] bool includeArchived = false,
        CancellationToken cancellationToken = default)
    {
        var ctx = await OpenAsync(cancellationToken);
        var doc = await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken);
        var items = (doc?.Document.Items ?? Array.Empty<Account>())
            .Where(a => includeArchived || !a.Archived)
            .Select(ToDto)
            .ToList();
        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<AccountDto>> Create(
        [FromBody] AccountUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (Validate(request) is { } problem)
        {
            return BadRequest(problem);
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken);
        var list = existing?.Document.Items ?? Array.Empty<Account>();

        if (list.Any(a => !a.Archived && a.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"An account named '{request.Name}' already exists."));
        }

        var created = new Account(
            Id: $"acc-{Guid.NewGuid():N}",
            Name: request.Name.Trim(),
            Type: request.Type.Trim().ToLowerInvariant(),
            Currency: request.Currency.Trim().ToUpperInvariant(),
            OpeningBalance: request.OpeningBalance,
            Color: request.Color,
            Icon: request.Icon,
            Archived: false);

        var next = new AccountList(SchemaVersions.Current, list.Append(created).ToArray());
        await ctx.AccountRepo.WriteAsync(DriveFileNames.Accounts, next, existing?.ETag, cancellationToken);

        return CreatedAtAction(nameof(List), ToDto(created));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<AccountDto>> Update(
        string id,
        [FromBody] AccountUpsertRequest request,
        CancellationToken cancellationToken)
    {
        if (Validate(request) is { } problem)
        {
            return BadRequest(problem);
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Account>()).ToList();
        var idx = list.FindIndex(a => a.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        if (list.Any(a => a.Id != id && !a.Archived &&
            a.Name.Equals(request.Name, StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(Problem400($"An account named '{request.Name}' already exists."));
        }

        list[idx] = list[idx] with
        {
            Name = request.Name.Trim(),
            Type = request.Type.Trim().ToLowerInvariant(),
            Currency = request.Currency.Trim().ToUpperInvariant(),
            OpeningBalance = request.OpeningBalance,
            Color = request.Color,
            Icon = request.Icon,
        };

        await ctx.AccountRepo.WriteAsync(
            DriveFileNames.Accounts,
            new AccountList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return Ok(ToDto(list[idx]));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        // The default Cash account is structural — block deletion so that
        // legacy expenses with a missing AccountId always have a target.
        if (id == DriveFileNames.DefaultAccountId)
        {
            return BadRequest(Problem400("The default Cash account can't be deleted."));
        }

        var ctx = await OpenAsync(cancellationToken);
        var existing = await ctx.AccountRepo.ReadAsync(DriveFileNames.Accounts, cancellationToken);
        var list = (existing?.Document.Items ?? Array.Empty<Account>()).ToList();
        var idx = list.FindIndex(a => a.Id == id);
        if (idx < 0)
        {
            return NotFound();
        }

        if (await AccountIsReferenced(ctx, id, cancellationToken))
        {
            return Conflict(new ProblemDetails
            {
                Type = "https://artha.example/problems/account-in-use",
                Title = "Account in use",
                Detail = "This account is referenced by one or more expenses. Archive it instead, or reassign those expenses first.",
                Status = StatusCodes.Status409Conflict,
            });
        }

        // Soft delete: keep the row so historical expense AccountId references stay resolvable.
        list[idx] = list[idx] with { Archived = true };
        await ctx.AccountRepo.WriteAsync(
            DriveFileNames.Accounts,
            new AccountList(SchemaVersions.Current, list),
            existing?.ETag,
            cancellationToken);

        return NoContent();
    }

    private async Task<bool> AccountIsReferenced(Context ctx, string accountId, CancellationToken cancellationToken)
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
            if (shard.Document.Items.Any(e => e.AccountId == accountId))
            {
                return true;
            }
        }
        return false;
    }

    private static ProblemDetails? Validate(AccountUpsertRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Problem400("Name is required.");
        }
        if (string.IsNullOrWhiteSpace(request.Type) || !AccountTypes.All.Contains(request.Type))
        {
            return Problem400(
                $"Type must be one of: {string.Join(", ", AccountTypes.All)}.");
        }
        if (string.IsNullOrWhiteSpace(request.Currency) || request.Currency.Length != 3)
        {
            return Problem400("Currency must be a 3-letter ISO code (e.g. USD).");
        }
        return null;
    }

    private static AccountDto ToDto(Account a) =>
        new(a.Id, a.Name, a.Type, a.Currency, a.OpeningBalance, a.Color, a.Icon, a.Archived);

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
            new AppDataRepository<AccountList>(drive),
            new AppDataRepository<Manifest>(drive),
            new AppDataRepository<ExpenseShard>(drive));
    }

    private sealed record Context(
        IDriveClient Drive,
        AppDataRepository<AccountList> AccountRepo,
        AppDataRepository<Manifest> ManifestRepo,
        AppDataRepository<ExpenseShard> ExpenseRepo);
}
