package api

import (
	"testing"

	"commander/internal/controlplane"
	"github.com/mlund01/squadron-wire/protocol"
)

func TestMergeWorkspaceVariablesIncludesDeclarationsAndProtectsSecrets(t *testing.T) {
	result := mergeWorkspaceVariables(
		[]controlplane.WorkspaceVariable{{Name: "region", HasValue: true, Value: "us-east"}, {Name: "api_key", HasValue: true, Value: "should-not-leak"}},
		[]protocol.VariableInfo{{Name: "api_key", Secret: true}, {Name: "optional", Secret: false}},
	)

	byName := make(map[string]controlplane.WorkspaceVariable, len(result))
	for _, item := range result {
		byName[item.Name] = item
	}
	if byName["api_key"].Value != "********" || !byName["api_key"].Secret {
		t.Fatalf("secret was not protected: %#v", byName["api_key"])
	}
	if byName["region"].Value != "us-east" {
		t.Fatalf("non-secret value changed: %#v", byName["region"])
	}
	if byName["optional"].HasValue {
		t.Fatalf("unset declaration reported a value: %#v", byName["optional"])
	}
}
