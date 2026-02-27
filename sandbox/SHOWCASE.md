## Showcase Protocol

When your work is ready to demo, write `/workspace/.showcase.json` so the human operator can preview it.

### Format

```json
{
  "label": "My Project",
  "type": "web | document | cli | media",
  "command": "command to run (web/cli only)",
  "port": 3001,
  "path": "/workspace/path/to/file (document/media only)"
}
```

### Types

- **web** — Serve a website. Required: `command` (start command), `port` (server port). Example: `{"type":"web","command":"cd /workspace/app && npm start","port":3001,"label":"Todo App"}`
- **document** — Display a text file. Required: `path`. Supports markdown, plain text, HTML. Example: `{"type":"document","path":"/workspace/novel/chapter1.md","label":"Chapter 1"}`
- **cli** — Run a command and show output. Required: `command`. Example: `{"type":"cli","command":"cd /workspace && python main.py --demo","label":"Demo Run"}`
- **media** — Display an image or SVG. Required: `path`. Example: `{"type":"media","path":"/workspace/output/chart.svg","label":"Chart"}`

### Rules
- Only write `.showcase.json` when you have something meaningful to show.
- For web type: ensure the command starts a server that listens on the specified port.
- For web type: use port 3001 or higher (3000 is taken by control plane).
- The `label` field is optional but recommended.
