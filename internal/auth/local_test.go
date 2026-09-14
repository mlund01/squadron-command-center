package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

type fakeLocalStore struct {
	claimed bool
	user    LocalUser
}

func (s *fakeLocalStore) IsClaimed(context.Context) (bool, error) {
	return s.claimed, nil
}

func (s *fakeLocalStore) ClaimInitialAdmin(_ context.Context, email, name string, hash []byte) (LocalUser, error) {
	s.claimed = true
	s.user = LocalUser{
		ID:           "user-1",
		Email:        email,
		Name:         name,
		PasswordHash: hash,
		Role:         "admin",
	}
	return s.user, nil
}

func (s *fakeLocalStore) AuthenticateLocal(context.Context, string) (LocalUser, error) {
	return s.user, nil
}

func TestLocalSetupClaimsUnclaimedInstance(t *testing.T) {
	store := &fakeLocalStore{}
	provider := NewLocalProvider(store, make([]byte, 32), false, "")

	setup := getSetupStatus(t, provider)
	if setup.Claimed {
		t.Fatal("fresh instance reported as claimed")
	}

	result := postSetup(t, provider, setup.CSRFToken, setupRequest{
		Email:           "admin@example.com",
		Name:            "Admin",
		Password:        "a-safe-password",
		PasswordConfirm: "a-safe-password",
	})
	if result.Code != http.StatusCreated {
		t.Fatalf("POST /api/setup = %d", result.Code)
	}
	if !store.claimed || store.user.Email != "admin@example.com" {
		t.Fatalf("instance was not claimed: %#v", store.user)
	}
}

func TestLocalSetupRequiresConfiguredToken(t *testing.T) {
	store := &fakeLocalStore{}
	provider := NewLocalProvider(store, make([]byte, 32), false, "expected")

	setup := getSetupStatus(t, provider)
	result := postSetup(t, provider, setup.CSRFToken, setupRequest{
		Email:           "admin@example.com",
		Password:        "a-safe-password",
		PasswordConfirm: "a-safe-password",
		SetupToken:      "wrong",
	})
	if result.Code != http.StatusForbidden {
		t.Fatalf("POST /api/setup with bad token = %d", result.Code)
	}
	if store.claimed {
		t.Fatal("bad setup token claimed the instance")
	}
}

func TestLocalBrowserLoginAPI(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("a-safe-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeLocalStore{claimed: true, user: LocalUser{
		ID: "user-1", Email: "admin@example.com", Name: "Admin", PasswordHash: hash, Role: "admin",
	}}
	provider := NewLocalProvider(store, make([]byte, 32), false, "")

	statusRequest := httptest.NewRequest(http.MethodGet, "/api/auth/login", nil)
	statusResult := httptest.NewRecorder()
	provider.handleBrowserLoginAPI(statusResult, statusRequest)
	if statusResult.Code != http.StatusOK {
		t.Fatalf("GET /api/auth/login = %d", statusResult.Code)
	}
	var status struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.NewDecoder(statusResult.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}

	payload, _ := json.Marshal(browserLoginRequest{
		Identity: "admin@example.com", Password: "a-safe-password", CSRFToken: status.CSRFToken, Next: "/workspaces",
	})
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(payload))
	loginRequest.AddCookie(&http.Cookie{Name: csrfCookieName, Value: status.CSRFToken})
	loginResult := httptest.NewRecorder()
	provider.handleBrowserLoginAPI(loginResult, loginRequest)
	if loginResult.Code != http.StatusOK {
		t.Fatalf("POST /api/auth/login = %d: %s", loginResult.Code, loginResult.Body.String())
	}
	var sessionCookieFound bool
	for _, cookie := range loginResult.Result().Cookies() {
		if cookie.Name == defaultCookieName && cookie.Value != "" {
			sessionCookieFound = true
		}
	}
	if !sessionCookieFound {
		t.Fatal("browser login did not set a session cookie")
	}
}

func getSetupStatus(t *testing.T, provider *Provider) setupResponse {
	t.Helper()

	request := httptest.NewRequest(http.MethodGet, "/api/setup", nil)
	result := httptest.NewRecorder()
	provider.handleSetup(result, request)
	if result.Code != http.StatusOK {
		t.Fatalf("GET /api/setup = %d", result.Code)
	}

	var response setupResponse
	if err := json.NewDecoder(result.Body).Decode(&response); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}
	if response.CSRFToken == "" {
		t.Fatal("setup response did not include a CSRF token")
	}
	return response
}

func postSetup(t *testing.T, provider *Provider, csrfToken string, body setupRequest) *httptest.ResponseRecorder {
	t.Helper()

	body.CSRFToken = csrfToken
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal setup request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/setup", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: csrfToken})
	result := httptest.NewRecorder()
	provider.handleSetup(result, request)
	return result
}
