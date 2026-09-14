package scheduling

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
	"github.com/robfig/cron/v3"
)

const dispatchTimeout = 30 * time.Second

type Store interface {
	ListDueMissionSchedules(context.Context, time.Time, int) ([]controlplane.MissionSchedule, error)
	ClaimMissionSchedule(context.Context, string, time.Time, time.Time) (bool, error)
	RecordMissionScheduleResult(context.Context, string, string, string, time.Time) error
	UserByID(context.Context, string) (controlplane.User, error)
	CanRunMission(context.Context, controlplane.User, string, string) (bool, error)
	CanRunMissionServicePrincipal(context.Context, string, string, string) (bool, error)
	RecordMissionRunActor(context.Context, controlplane.User, string, string, string) error
	RecordMissionRunServicePrincipal(context.Context, string, string, string, string) error
}

type missionDispatcher interface {
	GetRegistry() *hub.Registry
	SendRequest(string, *protocol.Envelope, time.Duration) (*protocol.Envelope, error)
}

type Scheduler struct {
	store    Store
	hub      missionDispatcher
	interval time.Duration
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

func New(store Store, h missionDispatcher) *Scheduler {
	ctx, cancel := context.WithCancel(context.Background())
	return &Scheduler{store: store, hub: h, interval: 10 * time.Second, ctx: ctx, cancel: cancel}
}

func (s *Scheduler) Start() {
	if s == nil || s.store == nil || s.hub == nil {
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runOnce(time.Now().UTC())
		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case now := <-ticker.C:
				s.runOnce(now.UTC())
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	if s == nil {
		return
	}
	s.cancel()
	s.wg.Wait()
}

func NextRun(expression, timezone string, after time.Time) (time.Time, error) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid timezone %q: %w", timezone, err)
	}
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	parsed, err := parser.Parse(expression)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid cron expression: %w", err)
	}
	return parsed.Next(after.In(location)).UTC(), nil
}

func (s *Scheduler) runOnce(now time.Time) {
	items, err := s.store.ListDueMissionSchedules(s.ctx, now, 100)
	if err != nil {
		if s.ctx.Err() == nil {
			log.Printf("scheduling: list due schedules: %v", err)
		}
		return
	}
	for _, item := range items {
		next, err := NextRun(item.CronExpression, item.Timezone, now)
		if err != nil {
			_ = s.store.RecordMissionScheduleResult(s.ctx, item.ID, "failed", err.Error(), now)
			continue
		}
		claimed, err := s.store.ClaimMissionSchedule(s.ctx, item.ID, item.NextRunAt, next)
		if err != nil || !claimed {
			continue
		}
		s.wg.Add(1)
		go func(schedule controlplane.MissionSchedule) {
			defer s.wg.Done()
			status, message := s.dispatch(schedule)
			if err := s.store.RecordMissionScheduleResult(s.ctx, schedule.ID, status, message, now); err != nil && s.ctx.Err() == nil {
				log.Printf("scheduling: record result for %s: %v", schedule.ID, err)
			}
		}(item)
	}
}

func (s *Scheduler) dispatch(schedule controlplane.MissionSchedule) (string, string) {
	instance := s.hub.GetRegistry().GetInstanceByWorkspaceID(schedule.WorkspaceID)
	if instance == nil || !instance.Connected {
		return "skipped", "workspace runner is disconnected"
	}

	var user controlplane.User
	if schedule.RunAsUserID != nil {
		var err error
		user, err = s.store.UserByID(s.ctx, *schedule.RunAsUserID)
		if err != nil {
			return "failed", "scheduled user is unavailable"
		}
		allowed, err := s.store.CanRunMission(s.ctx, user, schedule.WorkspaceID, schedule.MissionName)
		if err != nil || !allowed {
			return "failed", "scheduled user no longer has run permission"
		}
	} else if schedule.RunAsServicePrincipalID != nil {
		allowed, err := s.store.CanRunMissionServicePrincipal(s.ctx, *schedule.RunAsServicePrincipalID, schedule.WorkspaceID, schedule.MissionName)
		if err != nil || !allowed {
			return "failed", "scheduled service principal no longer has run permission"
		}
	} else {
		return "failed", "schedule has no run identity"
	}

	req, err := protocol.NewRequest(protocol.TypeRunMission, &protocol.RunMissionPayload{MissionName: schedule.MissionName, Inputs: schedule.Inputs})
	if err != nil {
		return "failed", err.Error()
	}
	resp, err := s.hub.SendRequest(instance.ID, req, dispatchTimeout)
	if err != nil {
		return "failed", err.Error()
	}
	var ack protocol.RunMissionAckPayload
	if err := protocol.DecodePayload(resp, &ack); err != nil {
		return "failed", "invalid response from workspace runner"
	}
	if !ack.Accepted {
		return "failed", ack.Reason
	}
	if schedule.RunAsUserID != nil {
		if err := s.store.RecordMissionRunActor(s.ctx, user, schedule.WorkspaceID, ack.MissionID, schedule.MissionName); err != nil {
			log.Printf("scheduling: record user actor: %v", err)
		}
	} else {
		if err := s.store.RecordMissionRunServicePrincipal(s.ctx, *schedule.RunAsServicePrincipalID, schedule.WorkspaceID, ack.MissionID, schedule.MissionName); err != nil {
			log.Printf("scheduling: record service principal actor: %v", err)
		}
	}
	return "started", ""
}
