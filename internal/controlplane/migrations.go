package controlplane

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/*.postgres.sql
var migrationFS embed.FS

var migrationPattern = regexp.MustCompile(`^(\d+)_([a-z0-9_]+)\.postgres\.sql$`)

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("read migrations: %w", err)
	}

	migrations := make([]migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		parts := migrationPattern.FindStringSubmatch(entry.Name())
		if parts == nil {
			return nil, fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		version, _ := strconv.Atoi(parts[1])
		body, err := fs.ReadFile(migrationFS, "migrations/"+entry.Name())
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		migrations = append(migrations, migration{version: version, name: parts[2], sql: string(body)})
	}

	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	for i, migration := range migrations {
		if migration.version != i+1 {
			return nil, fmt.Errorf("migration versions must be dense starting at 1; found %d", migration.version)
		}
	}
	return migrations, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL
    )`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	migrations, err := loadMigrations()
	if err != nil {
		return err
	}
	for _, migration := range migrations {
		var applied bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, migration.version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %d: %w", migration.version, err)
		}
		if applied {
			continue
		}
		if err := s.applyMigration(ctx, migration); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) applyMigration(ctx context.Context, migration migration) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin migration %d: %w", migration.version, err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, migration.sql); err != nil {
		return fmt.Errorf("apply migration %d (%s): %w", migration.version, migration.name, err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)`, migration.version, migration.name, time.Now().UTC()); err != nil {
		return fmt.Errorf("record migration %d: %w", migration.version, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration %d: %w", migration.version, err)
	}
	return nil
}
