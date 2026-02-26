# Ideas

## Persistent workspace volume
- Mount a host directory (e.g. `./data/workspace`) to `/workspace` in the sandbox container
- Agent files, memory (`.memory.md`), and any created work survive stop/start cycles
- Currently everything is wiped when the container is removed on stop
