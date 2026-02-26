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

  async status() {
    if (!this.containerId) return { status: "not_running" as const };
    try {
      const info = await this.docker.inspectContainer(this.containerId);
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
