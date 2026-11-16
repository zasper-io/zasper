package agents

import (
	"context"
	"errors"
	"fmt"
	"time"

	acp "github.com/coder/acp-go-sdk"

	"github.com/zasper-io/zasper/internal/analytics"
)

// How long an agent may take to answer a change to one of its settings.
const settingBudget = 30 * time.Second

/*
setSettings records the agent's settings for the session, the whole set each time, as ACP sends them.
An agent with a mode of its own decides what it asks, so the chat's mode then answers nothing for the
reader.
*/
func (c *Chat) setSettings(options []acp.SessionConfigOption) {
	if options == nil {
		options = []acp.SessionConfigOption{}
	}
	ownModes := false
	for _, option := range options {
		if categoryOf(option) == string(acp.SessionConfigOptionCategoryMode) {
			ownModes = true
		}
	}
	c.mu.Lock()
	// An agent with none says nothing, in the log as on the wire.
	unchanged := len(options) == 0 && len(c.settings) == 0
	c.settings = options
	c.ownModes = ownModes
	c.mu.Unlock()
	if !unchanged {
		c.record(Event{Type: "settings", Settings: options})
	}
}

// SetSetting changes one of the agent's settings to value, a string for a choice or a bool for a switch.
// The agent answers with the whole set, which may change other settings as well.
func (c *Chat) SetSetting(id string, value any) error {
	c.mu.Lock()
	if c.exited {
		c.mu.Unlock()
		return errors.New("the agent has stopped; start a new chat")
	}
	var option *acp.SessionConfigOption
	for i := range c.settings {
		if idOf(c.settings[i]) == id {
			option = &c.settings[i]
		}
	}
	session := c.session
	c.mu.Unlock()
	if option == nil {
		return fmt.Errorf("the agent has no setting %q", id)
	}

	var request acp.SetSessionConfigOptionRequest
	switch value := value.(type) {
	case string:
		request.ValueId = &acp.SetSessionConfigOptionValueId{SessionId: session, ConfigId: acp.SessionConfigId(id), Value: acp.SessionConfigValueId(value)}
	case bool:
		request.Boolean = &acp.SetSessionConfigOptionBoolean{SessionId: session, ConfigId: acp.SessionConfigId(id), Value: value}
	default:
		return fmt.Errorf("a setting is a choice or a switch, not %v", value)
	}
	ctx, cancel := context.WithTimeout(c.lifetime, settingBudget)
	defer cancel()
	answer, err := c.conn.SetSessionConfigOption(ctx, request)
	if err != nil {
		return err
	}
	category := categoryOf(*option)
	switch acp.SessionConfigOptionCategory(category) {
	case acp.SessionConfigOptionCategoryModel, acp.SessionConfigOptionCategoryThoughtLevel, acp.SessionConfigOptionCategoryMode:
	default:
		category = "other"
	}
	analytics.Track(analytics.EventAgentSettingChanged, map[string]interface{}{"agent": analytics.AgentKind(c.Agent), "category": category})
	c.setSettings(answer.ConfigOptions)
	return nil
}

func idOf(option acp.SessionConfigOption) string {
	switch {
	case option.Select != nil:
		return string(option.Select.Id)
	case option.Boolean != nil:
		return string(option.Boolean.Id)
	}
	return ""
}

func categoryOf(option acp.SessionConfigOption) string {
	var category *acp.SessionConfigOptionCategory
	switch {
	case option.Select != nil:
		category = option.Select.Category
	case option.Boolean != nil:
		category = option.Boolean.Category
	}
	if category == nil {
		return ""
	}
	return string(*category)
}
