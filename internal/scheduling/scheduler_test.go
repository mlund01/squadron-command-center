package scheduling

import (
	"testing"
	"time"
)

func TestNextRunUsesScheduleTimezone(t *testing.T) {
	after := time.Date(2026, time.September, 11, 12, 0, 0, 0, time.UTC)
	next, err := NextRun("0 9 * * *", "America/Chicago", after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, time.September, 11, 14, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("NextRun() = %s, want %s", next, want)
	}
}

func TestNextRunRejectsInvalidConfiguration(t *testing.T) {
	for _, test := range []struct{ expression, timezone string }{{"not cron", "UTC"}, {"0 9 * * *", "Mars/Olympus"}} {
		if _, err := NextRun(test.expression, test.timezone, time.Now()); err == nil {
			t.Fatalf("NextRun(%q, %q) succeeded", test.expression, test.timezone)
		}
	}
}
