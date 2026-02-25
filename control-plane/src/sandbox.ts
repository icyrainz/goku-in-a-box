import type { DockerClient } from "./docker";

const SANDBOX_IMAGE = "goku-sandbox:latest";
const SANDBOX_NAME = "goku-sandbox";

export class SandboxManager {
  containerId: string | null = null;
  private docker: DockerClient;

  constructor(docker: DockerClient) {
    this.docker = docker;
  }

  async start(env: Record<string, string> = {}) {
    if (this.containerId) {
      await this.stop();
    }
    const envArr = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    const { Id } = await this.docker.createContainer({
      image: SANDBOX_IMAGE,
      name: SANDBOX_NAME,
      env: [
        `CONTROL_PLANE_URL=http://host.docker.internal:3000`,
        ...envArr,
      ],
      extraHosts: ["host.docker.internal:host-gateway"],
    });
    await this.docker.startContainer(Id);
    this.containerId = Id;
    return Id;
  }

  async stop() {
    if (!this.containerId) return;
    await this.docker.stopContainer(this.containerId);
    await this.docker.removeContainer(this.containerId);
    this.containerId = null;
  }

  async status() {
    if (!this.containerId) return { status: "not_running" as const };
    try {
      const info = await this.docker.inspectContainer(this.containerId);
      return {
        status: info.State.Running ? ("running" as const) : ("stopped" as const),
        containerId: this.containerId,
      };
    } catch {
      this.containerId = null;
      return { status: "not_running" as const };
    }
  }
}
