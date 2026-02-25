// control-plane/src/docker.ts
const DOCKER_API_VERSION = "v1.47";

export class DockerClient {
  readonly socketPath: string;
  private baseUrl: string;

  constructor(socketPath = "/var/run/docker.sock") {
    this.socketPath = socketPath;
    this.baseUrl = `http://localhost/${DOCKER_API_VERSION}`;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      unix: this.socketPath,
    } as any);
  }

  buildCreatePayload(config: {
    image: string;
    name: string;
    cmd?: string[];
    env?: string[];
    binds?: string[];
    networkMode?: string;
    extraHosts?: string[];
  }) {
    return {
      Image: config.image,
      Cmd: config.cmd,
      Env: config.env ?? [],
      Tty: false,
      HostConfig: {
        Binds: config.binds ?? [],
        NetworkMode: config.networkMode ?? "host",
        ExtraHosts: config.extraHosts ?? [],
      },
    };
  }

  async createContainer(config: {
    image: string;
    name: string;
    cmd?: string[];
    env?: string[];
    binds?: string[];
    networkMode?: string;
    extraHosts?: string[];
  }) {
    const payload = this.buildCreatePayload(config);
    const res = await this.fetch(`/containers/create?name=${config.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Create container failed: ${await res.text()}`);
    return (await res.json()) as { Id: string };
  }

  async startContainer(id: string) {
    const res = await this.fetch(`/containers/${id}/start`, { method: "POST" });
    if (!res.ok && res.status !== 304) {
      throw new Error(`Start container failed: ${await res.text()}`);
    }
  }

  async stopContainer(id: string, timeout = 10) {
    const res = await this.fetch(`/containers/${id}/stop?t=${timeout}`, { method: "POST" });
    if (!res.ok && res.status !== 304 && res.status !== 404) {
      throw new Error(`Stop container failed: ${await res.text()}`);
    }
  }

  async removeContainer(id: string) {
    const res = await this.fetch(`/containers/${id}?force=true`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Remove container failed: ${await res.text()}`);
    }
  }

  async inspectContainer(id: string) {
    const res = await this.fetch(`/containers/${id}/json`);
    if (!res.ok) throw new Error(`Inspect container failed: ${await res.text()}`);
    return res.json();
  }

  async listContainers(filters?: Record<string, string[]>) {
    const params = filters ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : "";
    const res = await this.fetch(`/containers/json${params}`);
    if (!res.ok) throw new Error(`List containers failed: ${await res.text()}`);
    return res.json() as Promise<any[]>;
  }

  async streamLogs(id: string, onData: (line: string) => void, signal?: AbortSignal) {
    const res = await this.fetch(
      `/containers/${id}/logs?follow=true&stdout=true&stderr=true&timestamps=true`,
      { signal }
    );
    if (!res.ok || !res.body) throw new Error(`Stream logs failed: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (line.trim()) onData(line);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
