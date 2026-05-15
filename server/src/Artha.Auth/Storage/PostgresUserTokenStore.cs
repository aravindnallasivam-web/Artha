using System.Text.Json;
using Artha.Core.Auth;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Artha.Auth.Storage;

/// <summary>
/// Postgres-backed implementation of <see cref="IUserTokenStore"/>. Tokens
/// survive process restarts (DO App Platform redeploys), unlike the
/// in-memory store.
///
/// Schema: a single user_tokens table, created lazily on first use. The
/// payload column holds the JSON-serialized StoredUserTokens record.
///
/// Threat model: rows are stored as plaintext JSON. DigitalOcean Managed
/// Postgres encrypts the disk at rest and the connection is forced over
/// TLS, so a DB snapshot alone isn't enough to read tokens. App-layer
/// encryption can be layered on later if the threat model tightens (see
/// the README for the upgrade path).
/// </summary>
public sealed class PostgresUserTokenStore : IUserTokenStore
{
    private const string CreateTableSql = """
        CREATE TABLE IF NOT EXISTS user_tokens (
            user_id        TEXT PRIMARY KEY,
            payload        TEXT NOT NULL,
            updated_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """;

    private const string UpsertSql = """
        INSERT INTO user_tokens (user_id, payload, updated_at_utc)
        VALUES (@user_id, @payload, NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET payload = EXCLUDED.payload,
                updated_at_utc = NOW();
        """;

    private const string SelectSql = "SELECT payload FROM user_tokens WHERE user_id = @user_id;";
    private const string DeleteSql = "DELETE FROM user_tokens WHERE user_id = @user_id;";

    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<PostgresUserTokenStore> _logger;
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private bool _schemaReady;

    public PostgresUserTokenStore(NpgsqlDataSource dataSource, ILogger<PostgresUserTokenStore> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    public async Task SaveAsync(string userId, StoredUserTokens tokens, CancellationToken cancellationToken)
    {
        await EnsureSchemaAsync(cancellationToken);

        var payload = JsonSerializer.Serialize(tokens);

        await using var command = _dataSource.CreateCommand(UpsertSql);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("payload", payload);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<StoredUserTokens?> GetAsync(string userId, CancellationToken cancellationToken)
    {
        await EnsureSchemaAsync(cancellationToken);

        await using var command = _dataSource.CreateCommand(SelectSql);
        command.Parameters.AddWithValue("user_id", userId);

        var result = await command.ExecuteScalarAsync(cancellationToken);
        if (result is not string payload)
        {
            return null;
        }

        return JsonSerializer.Deserialize<StoredUserTokens>(payload);
    }

    public async Task DeleteAsync(string userId, CancellationToken cancellationToken)
    {
        await EnsureSchemaAsync(cancellationToken);

        await using var command = _dataSource.CreateCommand(DeleteSql);
        command.Parameters.AddWithValue("user_id", userId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task EnsureSchemaAsync(CancellationToken cancellationToken)
    {
        if (_schemaReady) return;
        await _initLock.WaitAsync(cancellationToken);
        try
        {
            if (_schemaReady) return;
            await using var command = _dataSource.CreateCommand(CreateTableSql);
            await command.ExecuteNonQueryAsync(cancellationToken);
            _schemaReady = true;
            _logger.LogInformation("user_tokens table ensured.");
        }
        finally
        {
            _initLock.Release();
        }
    }
}
