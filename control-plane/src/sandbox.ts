import type { DockerClient } from "./docker";

export type AgentType = "opencode" | "goose";

const IMAGE_MAP: Record<AgentType, string> = {
  opencode: "goku-sandbox-opencode:latest",
  goose: "goku-sandbox-goose:latest",
};

export class SandboxManager {
  containerId: string | null = null;
  agentType: AgentType | null = null;
  private docker: DockerClient;

  constructor(docker: DockerClient) {
    this.docker = docker;
  }

  async start(agentType: AgentType = "opencode", env: Record<string, string> = {}) {
    if (this.containerId) {
      await this.stop();
    }
    const image = IMAGE_MAP[agentType];
    const containerName = `goku-sandbox-${agentType}`;
    const envArr = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    const { Id } = await this.docker.createContainer({
      image,
      name: containerName,
      env: [
        `CONTROL_PLANE_URL=http://host.docker.internal:3000`,
        ...envArr,
      ],
      extraHosts: ["host.docker.internal:host-gateway"],
    });
    await this.docker.startContainer(Id);
    this.containerId = Id;
    this.agentType = agentType;
    return Id;
  }

  async stop() {
    if (!this.containerId) return;
    await this.docker.stopContainer(this.containerId);
    await this.docker.removeContainer(this.containerId);
    this.containerId = null;
    this.agentType = null;
  }

  async snapshot(): Promise<ReadableStream<Uint8Array>> {
    if (!this.containerId) throw new Error("No container running");
    return this.docker.getArchive(this.containerId, "/workspace");
  }

  async restoreStart(
    agentType: AgentType,
    env: Record<string, string>,
    tar: ReadableStream<Uint8Array> | ArrayBuffer
  ): Promise<string> {
    if (this.containerId) await this.stop();

    const image = IMAGE_MAP[agentType];
    const containerName = `goku-sandbox-${agentType}`;
    const envArr = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    const { Id } = await this.docker.createContainer({
      image,
      name: containerName,
      env: [`CONTROL_PLANE_URL=http://host.docker.internal:3000`, ...envArr],
      extraHosts: ["host.docker.internal:host-gateway"],
    });

    // Inject workspace tar before starting so agent-loop finds restored files
    await this.docker.putArchive(Id, "/", tar);
    await this.docker.startContainer(Id);
    this.containerId = Id;
    this.agentType = agentType;
    return Id;
  }

  async reconnect() {
    // Detect a running goku-sandbox container (survives control-plane restart)
    const containers = await this.docker.listContainers({ name: ["goku-sandbox-"] });
    for (const c of containers) {
      const name = (c.Names?.[0] ?? "").replace(/^\//, "");
      const match = name.match(/^goku-sandbox-(opencode|goose)$/);
      if (match && c.State === "running") {
        this.containerId = c.Id;
        this.agentType = match[1] as AgentType;
        return;
      }
    }
  }

  async status() {
    if (!this.containerId) return { status: "not_running" as const };
    try {
      const info = await this.docker.inspectContainer(this.containerId) as { State: { Running: boolean } };
      return {
        status: info.State.Running ? ("running" as const) : ("stopped" as const),
        containerId: this.containerId,
        agentType: this.agentType,
      };
    } catch {
      this.containerId = null;
      this.agentType = null;
      return { status: "not_running" as const };
    }
  }
}
