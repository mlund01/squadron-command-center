package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"commander/internal/controlplane"
	"commander/internal/scheduling"
)

type ScheduleStore interface {
	AuthorizationStore
	ListMissionSchedules(context.Context, string, string) ([]controlplane.MissionSchedule, error)
	ListWorkspaceMissionSchedules(context.Context, string) ([]controlplane.MissionSchedule, error)
	CreateMissionSchedule(context.Context, controlplane.User, string, string, controlplane.ScheduleValues) (controlplane.MissionSchedule, error)
	UpdateMissionSchedule(context.Context, controlplane.User, string, string, string, controlplane.ScheduleValues) (controlplane.MissionSchedule, error)
	DeleteMissionSchedule(context.Context, controlplane.User, string, string, string) error
}

func handleWorkspaceMissionSchedules(store ScheduleStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values, err := store.ListWorkspaceMissionSchedules(r.Context(), r.PathValue("id"))
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "schedules unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"schedules": values})
	}
}

type scheduleRequest struct {
	Name           string            `json:"name"`
	CronExpression string            `json:"cronExpression"`
	Timezone       string            `json:"timezone"`
	Inputs         map[string]string `json:"inputs"`
	RunAsKind      string            `json:"runAsKind"`
	RunAsID        string            `json:"runAsId"`
	Status         string            `json:"status"`
}

func handleMissionSchedules(store ScheduleStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, missionName := r.PathValue("id"), r.PathValue("name")
		if r.Method == http.MethodGet {
			values, err := store.ListMissionSchedules(r.Context(), workspaceID, missionName)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "schedules unavailable"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"schedules": values})
			return
		}
		actor, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		request, values, ok := decodeScheduleRequest(w, r, actor)
		if !ok {
			return
		}
		if request.RunAsKind == "service_principal" {
			allowed, err := store.CanUserRunAsServicePrincipal(r.Context(), actor, request.RunAsID, workspaceID, missionName)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authorization unavailable"})
				return
			}
			if !allowed {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Run-as permission is required"})
				return
			}
		}
		value, err := store.CreateMissionSchedule(r.Context(), actor, workspaceID, missionName, values)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, value)
	}
}

func handleMissionSchedule(store ScheduleStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, missionName, scheduleID := r.PathValue("id"), r.PathValue("name"), r.PathValue("scheduleId")
		actor, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		if r.Method == http.MethodDelete {
			err := store.DeleteMissionSchedule(r.Context(), actor, scheduleID, workspaceID, missionName)
			if errors.Is(err, controlplane.ErrScheduleNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
				return
			}
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "schedule could not be deleted"})
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		request, values, ok := decodeScheduleRequest(w, r, actor)
		if !ok {
			return
		}
		if request.RunAsKind == "service_principal" {
			allowed, err := store.CanUserRunAsServicePrincipal(r.Context(), actor, request.RunAsID, workspaceID, missionName)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authorization unavailable"})
				return
			}
			if !allowed {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Run-as permission is required"})
				return
			}
		}
		value, err := store.UpdateMissionSchedule(r.Context(), actor, scheduleID, workspaceID, missionName, values)
		if errors.Is(err, controlplane.ErrScheduleNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, value)
	}
}

func decodeScheduleRequest(w http.ResponseWriter, r *http.Request, actor controlplane.User) (scheduleRequest, controlplane.ScheduleValues, bool) {
	var request scheduleRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return request, controlplane.ScheduleValues{}, false
	}
	request.Name = strings.TrimSpace(request.Name)
	request.CronExpression = strings.TrimSpace(request.CronExpression)
	request.Timezone = strings.TrimSpace(request.Timezone)
	request.RunAsKind = strings.TrimSpace(request.RunAsKind)
	request.RunAsID = strings.TrimSpace(request.RunAsID)
	request.Status = strings.TrimSpace(request.Status)
	if request.CronExpression == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cron expression is required"})
		return request, controlplane.ScheduleValues{}, false
	}
	if request.Timezone == "" {
		request.Timezone = "UTC"
	}
	if request.Status == "" {
		request.Status = "active"
	}
	if request.Status != "active" && request.Status != "paused" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid schedule status"})
		return request, controlplane.ScheduleValues{}, false
	}
	if request.RunAsKind == "user" {
		if request.RunAsID == "" {
			request.RunAsID = actor.ID
		}
		if request.RunAsID != actor.ID {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Schedules may only run as you or an assigned service principal"})
			return request, controlplane.ScheduleValues{}, false
		}
	} else if request.RunAsKind == "service_principal" {
		if request.RunAsID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "run identity is required"})
			return request, controlplane.ScheduleValues{}, false
		}
	} else {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "run identity is required"})
		return request, controlplane.ScheduleValues{}, false
	}
	next, err := scheduling.NextRun(request.CronExpression, request.Timezone, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return request, controlplane.ScheduleValues{}, false
	}
	values := controlplane.ScheduleValues{Name: request.Name, CronExpression: request.CronExpression, Timezone: request.Timezone, Inputs: request.Inputs, Status: request.Status, NextRunAt: next}
	if values.Inputs == nil {
		values.Inputs = map[string]string{}
	}
	if request.RunAsKind == "user" {
		values.RunAsUserID = &request.RunAsID
	} else {
		values.RunAsServicePrincipalID = &request.RunAsID
	}
	return request, values, true
}
