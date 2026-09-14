package controlplane

import "testing"

func TestLoadMigrations(t *testing.T) {
	migrations, err := loadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}
	if len(migrations) == 0 {
		t.Fatal("expected at least one migration")
	}

	for index, migration := range migrations {
		if migration.version != index+1 {
			t.Fatalf("migration %q has version %d; want %d", migration.name, migration.version, index+1)
		}
		if migration.name == "" || migration.sql == "" {
			t.Fatalf("migration %d is incomplete: %#v", migration.version, migration)
		}
	}
}
