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
            CREATE TABLE IF NOT EXISTS branch_leases (
              lease_id TEXT PRIMARY KEY,
              repo TEXT NOT NULL,
              branch TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              revoked_at INTEGER NULL,
              CHECK(expires_at > created_at)
            );
            CREATE INDEX IF NOT EXISTS branch_leases_scope
              ON branch_leases(repo, branch, expires_at, revoked_at);
            CREATE TABLE IF NOT EXISTS audit_events (
              event_id TEXT PRIMARY KEY,
              event_type TEXT NOT NULL,
              repo TEXT NULL,
              branch TEXT NULL,
              outcome TEXT NOT NULL,
              detail TEXT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS audit_events_created_at
              ON audit_events(created_at DESC);
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
        using var transaction = connection.BeginTransaction();
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
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
        InsertAuditEvent(connection, transaction, "allowlist_changed", repo, null, enabled ? "enabled" : "disabled", null, now);
        transaction.Commit();
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

    public BranchLeaseRecord CreateBranchLease(string repo, string branch, long now, int minutes)
    {
        ValidateRepo(repo);
        branch = ValidateBranch(branch);
        if (minutes is < 1 or > 5) throw new AuthorityException("branch_lease_minutes_invalid");
        var lease = new BranchLeaseRecord(
            Guid.NewGuid().ToString("N"),
            repo,
            branch,
            now,
            checked(now + (minutes * 60L)),
            null);

        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using (var revoke = connection.CreateCommand())
        {
            revoke.Transaction = transaction;
            revoke.CommandText = """
                UPDATE branch_leases
                SET revoked_at=$now
                WHERE lower(repo)=lower($repo) AND branch=$branch AND revoked_at IS NULL AND expires_at > $now;
                """;
            revoke.Parameters.AddWithValue("$now", now);
            revoke.Parameters.AddWithValue("$repo", repo);
            revoke.Parameters.AddWithValue("$branch", branch);
            revoke.ExecuteNonQuery();
        }
        using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO branch_leases(lease_id,repo,branch,created_at,expires_at,revoked_at)
                VALUES($id,$repo,$branch,$created,$expires,NULL);
                """;
            insert.Parameters.AddWithValue("$id", lease.LeaseId);
            insert.Parameters.AddWithValue("$repo", lease.Repo);
            insert.Parameters.AddWithValue("$branch", lease.Branch);
            insert.Parameters.AddWithValue("$created", lease.CreatedAt);
            insert.Parameters.AddWithValue("$expires", lease.ExpiresAt);
            insert.ExecuteNonQuery();
        }
        InsertAuditEvent(connection, transaction, "branch_lease_created", repo, branch, "approved", $"expires_at={lease.ExpiresAt}", now);
        transaction.Commit();
        return lease;
    }

    public BranchLeaseRecord? TryGetActiveBranchLease(string repo, string branch, long now)
    {
        ValidateRepo(repo);
        branch = ValidateBranch(branch);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT lease_id,repo,branch,created_at,expires_at,revoked_at
            FROM branch_leases
            WHERE lower(repo)=lower($repo) AND branch=$branch AND revoked_at IS NULL AND expires_at > $now
            ORDER BY expires_at DESC LIMIT 1;
            """;
        command.Parameters.AddWithValue("$repo", repo);
        command.Parameters.AddWithValue("$branch", branch);
        command.Parameters.AddWithValue("$now", now);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadBranchLease(reader) : null;
    }

    public BranchLeaseRecord? TryUseActiveBranchLease(string repo, string branch, long now, int operationCount)
    {
        ValidateRepo(repo);
        branch = ValidateBranch(branch);
        if (operationCount <= 0) throw new AuthorityException("branch_lease_operation_count_invalid");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        BranchLeaseRecord? lease = null;
        using (var select = connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = """
                SELECT lease_id,repo,branch,created_at,expires_at,revoked_at
                FROM branch_leases
                WHERE lower(repo)=lower($repo) AND branch=$branch AND revoked_at IS NULL AND expires_at > $now
                ORDER BY expires_at DESC LIMIT 1;
                """;
            select.Parameters.AddWithValue("$repo", repo);
            select.Parameters.AddWithValue("$branch", branch);
            select.Parameters.AddWithValue("$now", now);
            using var reader = select.ExecuteReader();
            if (reader.Read()) lease = ReadBranchLease(reader);
        }
        if (lease is null)
        {
            transaction.Rollback();
            return null;
        }
        InsertAuditEvent(
            connection,
            transaction,
            "branch_lease_used",
            lease.Repo,
            lease.Branch,
            "approved",
            $"lease_id={lease.LeaseId};operations={operationCount}",
            now);
        transaction.Commit();
        return lease;
    }

    public IReadOnlyList<BranchLeaseRecord> ListActiveBranchLeases(long now)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT lease_id,repo,branch,created_at,expires_at,revoked_at
            FROM branch_leases
            WHERE revoked_at IS NULL AND expires_at > $now
            ORDER BY expires_at ASC, lower(repo), branch;
            """;
        command.Parameters.AddWithValue("$now", now);
        using var reader = command.ExecuteReader();
        var leases = new List<BranchLeaseRecord>();
        while (reader.Read()) leases.Add(ReadBranchLease(reader));
        return leases;
    }

    public int RecordExpiredBranchLeases(long now)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        var expired = new List<BranchLeaseRecord>();
        using (var select = connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = """
                SELECT bl.lease_id,bl.repo,bl.branch,bl.created_at,bl.expires_at,bl.revoked_at
                FROM branch_leases bl
                WHERE bl.revoked_at IS NULL
                  AND bl.expires_at <= $now
                  AND NOT EXISTS (
                    SELECT 1 FROM audit_events a
                    WHERE a.event_type='branch_lease_expired'
                      AND a.detail=('lease_id=' || bl.lease_id)
                  )
                ORDER BY bl.expires_at, bl.lease_id;
                """;
            select.Parameters.AddWithValue("$now", now);
            using var reader = select.ExecuteReader();
            while (reader.Read()) expired.Add(ReadBranchLease(reader));
        }
        foreach (var lease in expired)
        {
            InsertAuditEvent(
                connection,
                transaction,
                "branch_lease_expired",
                lease.Repo,
                lease.Branch,
                "expired",
                $"lease_id={lease.LeaseId}",
                lease.ExpiresAt);
        }
        transaction.Commit();
        return expired.Count;
    }

    public bool RevokeBranchLease(string leaseId, long now)
    {
        if (string.IsNullOrWhiteSpace(leaseId)) throw new AuthorityException("branch_lease_id_invalid");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        BranchLeaseRecord? lease = null;
        using (var select = connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = "SELECT lease_id,repo,branch,created_at,expires_at,revoked_at FROM branch_leases WHERE lease_id=$id LIMIT 1;";
            select.Parameters.AddWithValue("$id", leaseId);
            using var reader = select.ExecuteReader();
            if (reader.Read()) lease = ReadBranchLease(reader);
        }
        if (lease is null || lease.RevokedAt is not null || lease.ExpiresAt <= now)
        {
            transaction.Rollback();
            return false;
        }
        using (var update = connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText = "UPDATE branch_leases SET revoked_at=$now WHERE lease_id=$id AND revoked_at IS NULL;";
            update.Parameters.AddWithValue("$now", now);
            update.Parameters.AddWithValue("$id", leaseId);
            if (update.ExecuteNonQuery() != 1) throw new AuthorityException("branch_lease_revoke_race");
        }
        InsertAuditEvent(connection, transaction, "branch_lease_revoked", lease.Repo, lease.Branch, "revoked", null, now);
        transaction.Commit();
        return true;
    }

    public void RecordAuditEvent(string eventType, string? repo, string? branch, string outcome, string? detail, long now)
    {
        if (string.IsNullOrWhiteSpace(eventType)) throw new AuthorityException("audit_event_type_invalid");
        if (string.IsNullOrWhiteSpace(outcome)) throw new AuthorityException("audit_event_outcome_invalid");
        if (repo is not null) ValidateRepo(repo);
        if (branch is not null) branch = ValidateBranch(branch);
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        InsertAuditEvent(connection, transaction, eventType, repo, branch, outcome, detail, now);
        transaction.Commit();
    }

    public IReadOnlyList<AuditEventRecord> ListRecentAuditEvents(int limit = 50)
    {
        if (limit is < 1 or > 100) throw new AuthorityException("audit_event_limit_invalid");
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT event_id,event_type,repo,branch,outcome,detail,created_at
            FROM audit_events
            ORDER BY created_at DESC, event_id DESC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", limit);
        using var reader = command.ExecuteReader();
        var events = new List<AuditEventRecord>();
        while (reader.Read()) events.Add(ReadAuditEvent(reader));
        return events;
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

    private static void InsertAuditEvent(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string eventType,
        string? repo,
        string? branch,
        string outcome,
        string? detail,
        long now)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO audit_events(event_id,event_type,repo,branch,outcome,detail,created_at)
            VALUES($id,$type,$repo,$branch,$outcome,$detail,$createdAt);
            """;
        command.Parameters.AddWithValue("$id", Guid.NewGuid().ToString("N"));
        command.Parameters.AddWithValue("$type", eventType);
        command.Parameters.AddWithValue("$repo", repo is null ? DBNull.Value : repo);
        command.Parameters.AddWithValue("$branch", branch is null ? DBNull.Value : branch);
        command.Parameters.AddWithValue("$outcome", outcome);
        command.Parameters.AddWithValue("$detail", string.IsNullOrEmpty(detail) ? DBNull.Value : detail.Length <= 500 ? detail : detail[..500]);
        command.Parameters.AddWithValue("$createdAt", now);
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

    private static BranchLeaseRecord ReadBranchLease(SqliteDataReader reader)
        => new(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetInt64(3),
            reader.GetInt64(4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5));

    private static AuditEventRecord ReadAuditEvent(SqliteDataReader reader)
        => new(
            reader.GetString(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.GetInt64(6));

    private static void ValidateRepo(string repo)
    {
        var parts = repo.Split('/');
        if (parts.Length != 2 || parts.Any(string.IsNullOrWhiteSpace) || parts.Any(value => value.Contains(' ')))
        {
            throw new AuthorityException("repo_invalid");
        }
    }

    private static string ValidateBranch(string branch)
    {
        var value = branch?.Trim() ?? string.Empty;
        if (value.Length == 0 || value.Length > 1024 || value.Any(char.IsControl))
        {
            throw new AuthorityException("branch_invalid");
        }
        return value;
    }
}
