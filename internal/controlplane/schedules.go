package controlplane

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrScheduleNotFound = errors.New("mission schedule not found")

type MissionSchedule struct {
	ID                      string            `json:"id"`
	WorkspaceID             string            `json:"workspaceId"`
	MissionName             string            `json:"missionName"`
	Name                    string            `json:"name"`
	CronExpression          string            `json:"cronExpression"`
	Timezone                string            `json:"timezone"`
	Inputs                  map[string]string `json:"inputs"`
	RunAsUserID             *string           `json:"runAsUserId,omitempty"`
	RunAsServicePrincipalID *string           `json:"runAsServicePrincipalId,omitempty"`
	Status                  string            `json:"status"`
	NextRunAt               time.Time         `json:"nextRunAt"`
	LastRunAt               *time.Time        `json:"lastRunAt,omitempty"`
	LastRunStatus           *string           `json:"lastRunStatus,omitempty"`
	LastError               string            `json:"lastError,omitempty"`
	CreatedBy               string            `json:"createdBy"`
	CreatedAt               time.Time         `json:"createdAt"`
	UpdatedAt               time.Time         `json:"updatedAt"`
}

type ScheduleValues struct {
	Name                    string
	CronExpression          string
	Timezone                string
	Inputs                  map[string]string
	RunAsUserID             *string
	RunAsServicePrincipalID *string
	Status                  string
	NextRunAt               time.Time
}

const scheduleColumns = `id,workspace_id,mission_name,name,cron_expression,timezone,inputs,run_as_user_id,run_as_service_principal_id,status,next_run_at,last_run_at,last_run_status,last_error,created_by,created_at,updated_at`

func scanSchedule(row pgx.Row) (MissionSchedule, error) {
	var value MissionSchedule
	err := row.Scan(&value.ID, &value.WorkspaceID, &value.MissionName, &value.Name, &value.CronExpression, &value.Timezone, &value.Inputs, &value.RunAsUserID, &value.RunAsServicePrincipalID, &value.Status, &value.NextRunAt, &value.LastRunAt, &value.LastRunStatus, &value.LastError, &value.CreatedBy, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

func (s *Store) ListMissionSchedules(ctx context.Context, workspaceID, missionName string) ([]MissionSchedule, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+scheduleColumns+` FROM mission_schedules WHERE workspace_id=$1 AND mission_name=$2 ORDER BY LOWER(name),created_at`, workspaceID, missionName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MissionSchedule{}
	for rows.Next() {
		value, err := scanSchedule(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (s *Store) ListWorkspaceMissionSchedules(ctx context.Context, workspaceID string) ([]MissionSchedule, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+scheduleColumns+` FROM mission_schedules WHERE workspace_id=$1 ORDER BY mission_name,LOWER(name),created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MissionSchedule{}
	for rows.Next() {
		value, err := scanSchedule(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (s *Store) CreateMissionSchedule(ctx context.Context, actor User, workspaceID, missionName string, values ScheduleValues) (MissionSchedule, error) {
	value, err := scanSchedule(s.pool.QueryRow(ctx, `INSERT INTO mission_schedules (id,workspace_id,mission_name,name,cron_expression,timezone,inputs,run_as_user_id,run_as_service_principal_id,status,next_run_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+scheduleColumns, uuid.NewString(), workspaceID, missionName, values.Name, values.CronExpression, values.Timezone, values.Inputs, values.RunAsUserID, values.RunAsServicePrincipalID, values.Status, values.NextRunAt, actor.ID))
	if err == nil {
		_ = s.audit(ctx, actor.ID, "mission_schedule.created", map[string]any{"workspaceId": workspaceID, "missionName": missionName, "scheduleId": value.ID})
	}
	return value, err
}

func (s *Store) UpdateMissionSchedule(ctx context.Context, actor User, id, workspaceID, missionName string, values ScheduleValues) (MissionSchedule, error) {
	value, err := scanSchedule(s.pool.QueryRow(ctx, `UPDATE mission_schedules SET name=$4,cron_expression=$5,timezone=$6,inputs=$7,run_as_user_id=$8,run_as_service_principal_id=$9,status=$10,next_run_at=$11,updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND mission_name=$3 RETURNING `+scheduleColumns, id, workspaceID, missionName, values.Name, values.CronExpression, values.Timezone, values.Inputs, values.RunAsUserID, values.RunAsServicePrincipalID, values.Status, values.NextRunAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return MissionSchedule{}, ErrScheduleNotFound
	}
	if err == nil {
		_ = s.audit(ctx, actor.ID, "mission_schedule.updated", map[string]any{"workspaceId": workspaceID, "missionName": missionName, "scheduleId": id, "status": values.Status})
	}
	return value, err
}

func (s *Store) DeleteMissionSchedule(ctx context.Context, actor User, id, workspaceID, missionName string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM mission_schedules WHERE id=$1 AND workspace_id=$2 AND mission_name=$3`, id, workspaceID, missionName)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrScheduleNotFound
	}
	return s.audit(ctx, actor.ID, "mission_schedule.deleted", map[string]any{"workspaceId": workspaceID, "missionName": missionName, "scheduleId": id})
}

func (s *Store) ListDueMissionSchedules(ctx context.Context, now time.Time, limit int) ([]MissionSchedule, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+scheduleColumns+` FROM mission_schedules WHERE status='active' AND next_run_at<=$1 ORDER BY next_run_at LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MissionSchedule{}
	for rows.Next() {
		value, err := scanSchedule(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (s *Store) ClaimMissionSchedule(ctx context.Context, id string, expected, next time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE mission_schedules SET next_run_at=$3,updated_at=NOW() WHERE id=$1 AND status='active' AND next_run_at=$2`, id, expected, next)
	return err == nil && tag.RowsAffected() == 1, err
}

func (s *Store) RecordMissionScheduleResult(ctx context.Context, id, status, message string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE mission_schedules SET last_run_at=$2,last_run_status=$3,last_error=$4,updated_at=NOW() WHERE id=$1`, id, at, status, message)
	return err
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `SELECT id,email,name,password_hash,role FROM users WHERE id=$1 AND status='active'`, id).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role)
	return user, err
}
