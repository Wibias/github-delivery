using Microsoft.Data.Sqlite;

namespace GitHubDeliveryAuthority;

internal sealed class StateStore : IDisposable
{
    private readonly string _connectionString;

    public StateStore(string databasePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(databasePath) ?? ".");
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        Initialize();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private void Initialize()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS allowed_repositories (
              repo TEXT PRIMARY KEY,
              enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signing_keys (
              kid TEXT PRIMARY KEY,
              key_name TEXT NOT NULL UNIQUE,
              public_key_pem TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active','retiring','retired')),
              created_at INTEGER NOT NULL,
              retire_after INTEGER NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_signing_key
              ON signing_keys(status) WHERE status='active';
            CREATE TABLE IF NOT EXISTS approvals (
              approval_id TEXT PRIMARY KEY,
              batch_id TEXT NOT NULL UNIQUE,
              batch_hash TEXT NOT NULL,
              repo TEXT NOT NULL,
              approval_method TEXT NOT NULL,
              approved_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              operation_count INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS grants (
              nonce TEXT PRIMARY KEY,
              approval_id TEXT NOT NULL REFERENCES approvals(approval_id),
              batch_id TEXT NOT NULL,
              batch_index INTEGER NOT NULL,
              kid TEXT NOT NULL REFERENCES signing_keys(kid),
              repo TEXT NOT NULL,
              action TEXT NOT NULL,
              scope_hash TEXT NOT NULL,
              issued_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('issued','consumed','expired')),
              consumed_at INTEGER NULL,
              UNIQUE(batch_id, batch_index)
            );
            """;
        command.ExecuteNonQuery();
    }

    public bool IsRepositoryAllowed(string repo)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT enabled FROM allowed_repositories WHERE lower(repo)=lower($repo) LIMIT 1;";
        command.Parameters.AddWithValue("$repo", repo);
        var result = command.ExecuteScalar();
        return result is long value && value == 1;
    }

    public IReadOnlyList<string> ListAllowedRepositories()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT repo FROM allowed_repositories WHERE enabled=1 ORDER BY lower(repo), repo;";
        using var reader = command.ExecuteReader();
        var values = new List<string>();
        while (reader.Read()) values.Add(reader.GetString(0));
        return values;
    }

    public void SetRepositoryAllowed(string repo, bool enabled, long now)
    {
        ValidateRepo(repo);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO allowed_repositories(repo, enabled, updated_at)
            VALUES($repo, $enabled, $now)
            ON CONFLICT(repo) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$repo", repo);
        command.Parameters.AddWithValue("$enabled", enabled ? 1 : 0);
        command.Parameters.AddWithValue("$now", now);
        command.ExecuteNonQuery();
    }

    public SigningKeyRecord? GetActiveSigningKey()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT kid,key_name,public_key_pem,status,created_at,retire_after FROM signing_keys WHERE status='active' LIMIT 1;";
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadKey(reader) : null;
    }

    public SigningKeyRecord? GetSigningKey(string kid)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT kid,key_name,public_key_pem,status,created_at,retire_after FROM signing_keys WHERE kid=$kid LIMIT 1;";
        command.Parameters.AddWithValue("$kid", kid);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadKey(reader) : null;
    }

    public IReadOnlyList<SigningKeyRecord> ListSigningKeys(bool includeRetired = true)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = includeRetired
            ? "SELECT kid,key_name,public_key_pem,status,created_at,retire_after FROM signing_keys ORDER BY created_at DESC;"
            : "SELECT kid,key_name,public_key_pem,status,created_at,retire_after FROM signing_keys WHERE status!='retired' ORDER BY created_at DESC;";
        using var reader = command.ExecuteReader();
        var keys = new List<SigningKeyRecord>();
        while (reader.Read()) keys.Add(ReadKey(reader));
        return keys;
    }

    public void InsertInitialSigningKey(SigningKeyRecord key)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var count = connection.CreateCommand();
        count.Transaction = transaction;
        count.CommandText = "SELECT COUNT(*) FROM signing_keys WHERE status='active';";
        if (Convert.ToInt64(count.ExecuteScalar()) != 0) throw new AuthorityException("active_signing_key_exists");
        InsertKey(connection, transaction, key);
        transaction.Commit();
    }

    public void RotateSigningKey(SigningKeyRecord next, long retireAfter)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using (var update = connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText = "UPDATE signing_keys SET status='retiring', retire_after=$retireAfter WHERE status='active';";
            update.Parameters.AddWithValue("$retireAfter", retireAfter);
            if (update.ExecuteNonQuery() != 1) throw new AuthorityException("active_signing_key_missing");
        }
        InsertKey(connection, transaction, next);
        transaction.Commit();
    }

    public IReadOnlyList<SigningKeyRecord> RetireExpiredKeys(long now)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var expired = new List<SigningKeyRecord>();
        using (var select = connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = "SELECT kid,key_name,public_key_pem,status,created_at,retire_after FROM signing_keys WHERE status='retiring' AND retire_after IS NOT NULL AND retire_after <= $now;";
            select.Parameters.AddWithValue("$now", now);
            using var reader = select.ExecuteReader();
            while (reader.Read()) expired.Add(ReadKey(reader));
        }
        using (var update = connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText = "UPDATE signing_keys SET status='retired' WHERE status='retiring' AND retire_after IS NOT NULL AND retire_after <= $now;";
            update.Parameters.AddWithValue("$now", now);
            update.ExecuteNonQuery();
        }
        transaction.Commit();
        return expired;
    }

    public void RecordApprovalAndGrants(
        string approvalId,
        string batchId,
        string batchHash,
        string repo,
        string approvalMethod,
        long approvedAt,
        long expiresAt,
        IReadOnlyList<GrantLedgerRecord> grants)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using (var approval = connection.CreateCommand())
        {
            approval.Transaction = transaction;
            approval.CommandText = """
                INSERT INTO approvals(approval_id,batch_id,batch_hash,repo,approval_method,approved_at,expires_at,operation_count)
                VALUES($approvalId,$batchId,$batchHash,$repo,$approvalMethod,$approvedAt,$expiresAt,$count);
                """;
            approval.Parameters.AddWithValue("$approvalId", approvalId);
            approval.Parameters.AddWithValue("$batchId", batchId);
            approval.Parameters.AddWithValue("$batchHash", batchHash);
            approval.Parameters.AddWithValue("$repo", repo);
            approval.Parameters.AddWithValue("$approvalMethod", approvalMethod);
            approval.Parameters.AddWithValue("$approvedAt", approvedAt);
            approval.Parameters.AddWithValue("$expiresAt", expiresAt);
            approval.Parameters.AddWithValue("$count", grants.Count);
            approval.ExecuteNonQuery();
        }
        foreach (var grant in grants)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO grants(nonce,approval_id,batch_id,batch_index,kid,repo,action,scope_hash,issued_at,expires_at,status)
                VALUES($nonce,$approvalId,$batchId,$batchIndex,$kid,$repo,$action,$scopeHash,$issuedAt,$expiresAt,'issued');
                """;
            command.Parameters.AddWithValue("$nonce", grant.Nonce);
            command.Parameters.AddWithValue("$approvalId", approvalId);
            command.Parameters.AddWithValue("$batchId", grant.BatchId);
            command.Parameters.AddWithValue("$batchIndex", grant.BatchIndex);
            command.Parameters.AddWithValue("$kid", grant.Kid);
            command.Parameters.AddWithValue("$repo", grant.Repo);
            command.Parameters.AddWithValue("$action", grant.Action);
            command.Parameters.AddWithValue("$scopeHash", grant.ScopeSha256);
            command.Parameters.AddWithValue("$issuedAt", grant.IssuedAt);
            command.Parameters.AddWithValue("$expiresAt", grant.ExpiresAt);
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    public long ConsumeGrant(string nonce, string repo, string scopeHash, long now)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        string status;
        string storedRepo;
        string storedScope;
        long expiresAt;
        using (var select = connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = "SELECT repo,scope_hash,expires_at,status FROM grants WHERE nonce=$nonce LIMIT 1;";
            select.Parameters.AddWithValue("$nonce", nonce);
            using var reader = select.ExecuteReader();
            if (!reader.Read()) throw new AuthorityException("grant_not_issued");
            storedRepo = reader.GetString(0);
            storedScope = reader.GetString(1);
            expiresAt = reader.GetInt64(2);
            status = reader.GetString(3);
        }
        if (!string.Equals(storedRepo, repo, StringComparison.OrdinalIgnoreCase)) throw new AuthorityException("grant_repo_mismatch");
        if (!string.Equals(storedScope, scopeHash, StringComparison.Ordinal)) throw new AuthorityException("grant_scope_mismatch");
        if (expiresAt < now)
        {
            using var expire = connection.CreateCommand();
            expire.Transaction = transaction;
            expire.CommandText = "UPDATE grants SET status='expired' WHERE nonce=$nonce AND status='issued';";
            expire.Parameters.AddWithValue("$nonce", nonce);
            expire.ExecuteNonQuery();
            transaction.Commit();
            throw new AuthorityException("grant_expired");
        }
        if (!string.Equals(status, "issued", StringComparison.Ordinal)) throw new AuthorityException("grant_already_consumed");

        using var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = "UPDATE grants SET status='consumed', consumed_at=$now WHERE nonce=$nonce AND status='issued';";
        update.Parameters.AddWithValue("$now", now);
        update.Parameters.AddWithValue("$nonce", nonce);
        if (update.ExecuteNonQuery() != 1) throw new AuthorityException("grant_consume_race");
        transaction.Commit();
        return now;
    }

    public void Dispose() { }

    private static void InsertKey(SqliteConnection connection, SqliteTransaction transaction, SigningKeyRecord key)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO signing_keys(kid,key_name,public_key_pem,status,created_at,retire_after)
            VALUES($kid,$name,$publicKey,$status,$createdAt,$retireAfter);
            """;
        command.Parameters.AddWithValue("$kid", key.Kid);
        command.Parameters.AddWithValue("$name", key.KeyName);
        command.Parameters.AddWithValue("$publicKey", key.PublicKeyPem);
        command.Parameters.AddWithValue("$status", key.Status);
        command.Parameters.AddWithValue("$createdAt", key.CreatedAt);
        command.Parameters.AddWithValue("$retireAfter", key.RetireAfter is null ? DBNull.Value : key.RetireAfter.Value);
        command.ExecuteNonQuery();
    }

    private static SigningKeyRecord ReadKey(SqliteDataReader reader)
        => new(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetInt64(4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5));

    private static void ValidateRepo(string repo)
    {
        var parts = repo.Split('/');
        if (parts.Length != 2 || parts.Any(string.IsNullOrWhiteSpace) || parts.Any(value => value.Contains(' ')))
        {
            throw new AuthorityException("repo_invalid");
        }
    }
}
