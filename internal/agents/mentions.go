package agents

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

/*
Mention is something the reader pointed the agent at with their message. A file goes as a link the agent
reads for itself. A cell or an output goes with its text as the reader sees it, unsaved edits and all:
embedded, for an agent that takes embedded context, and as part of the message for one that does not.
*/
type Mention struct {
	// file, cell or output.
	Kind string `json:"kind"`
	// Relative to the project.
	Path   string `json:"path"`
	Label  string `json:"label"`
	CellID string `json:"cell_id,omitempty"`
	// A cell's source or an output's text. Not kept in the log.
	Text string `json:"text,omitempty"`
}

// promptBlocks is the reader's message and what it mentions, as the agent is sent them.
func (c *Chat) promptBlocks(text string, mentions []Mention) ([]acp.ContentBlock, error) {
	blocks := []acp.ContentBlock{acp.TextBlock(text)}
	for _, mention := range mentions {
		path := filepath.Join(c.root, filepath.FromSlash(mention.Path))
		if _, err := (chatClient{c}).inProject(path); err != nil || mention.Path == "" {
			return nil, fmt.Errorf("%s is not in the project", mention.Path)
		}
		uri := (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String()
		switch mention.Kind {
		case "file":
			blocks = append(blocks, acp.ResourceLinkBlock(mention.Path, uri))
		case "cell", "output":
			uri += "#cell=" + url.QueryEscape(mention.CellID)
			if mention.Kind == "output" {
				uri += "&output"
			}
			if c.embedded {
				mime := "text/plain"
				blocks = append(blocks, acp.ResourceBlock(acp.EmbeddedResourceResource{
					TextResourceContents: &acp.TextResourceContents{Uri: uri, Text: mention.Text, MimeType: &mime},
				}))
			} else {
				blocks = append(blocks, acp.TextBlock(fmt.Sprintf("%s:\n```\n%s\n```", mention.Label, strings.TrimRight(mention.Text, "\n"))))
			}
		default:
			return nil, fmt.Errorf("cannot mention a %q", mention.Kind)
		}
	}
	return blocks, nil
}

// logged is the mentions as the log keeps them: without their text, which the agent was given.
func logged(mentions []Mention) []Mention {
	if len(mentions) == 0 {
		return nil
	}
	kept := make([]Mention, len(mentions))
	for i, mention := range mentions {
		mention.Text = ""
		kept[i] = mention
	}
	return kept
}
