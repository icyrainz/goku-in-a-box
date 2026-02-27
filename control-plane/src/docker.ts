// control-plane/src/docker.ts
const DOCKER_API_VERSION = `v${process.env.DOCKER_API_VERSION ?? "1.47"}`;

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
    portBindings?: Record<string, Array<{ HostPort: string }>>;
  }) {
    const exposedPorts: Record<string, object> = {};
    if (config.portBindings) {
      for (const containerPort of Object.keys(config.portBindings)) {
        exposedPorts[containerPort] = {};
      }
    }
    return {
      Image: config.image,
      Cmd: config.cmd,
      Env: config.env ?? [],
      Tty: false,
      ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
      HostConfig: {
        Binds: config.binds ?? [],
        NetworkMode: config.networkMode ?? "bridge",
        ExtraHosts: config.extraHosts ?? [],
        PortBindings: config.portBindings,
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
    portBindings?: Record<string, Array<{ HostPort: string }>>;
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

  buildExecPayload(cmd: string[], detach: boolean) {
    return {
      AttachStdout: !detach,
      AttachStderr: !detach,
      Detach: detach,
      Cmd: cmd,
    };
  }

  async execDetached(containerId: string, cmd: string[]): Promise<string> {
    const createRes = await this.fetch(`/containers/${containerId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildExecPayload(cmd, true)),
    });
    if (!createRes.ok) throw new Error(`Create exec failed: ${await createRes.text()}`);
    const { Id: execId } = (await createRes.json()) as { Id: string };

    const startRes = await this.fetch(`/exec/${execId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Detach: true, Tty: false }),
    });
    if (!startRes.ok) throw new Error(`Start exec failed: ${await startRes.text()}`);

    return execId;
  }

  async execInContainer(containerId: string, cmd: string[]): Promise<string> {
    // Create exec instance
    const createRes = await this.fetch(`/containers/${containerId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd,
      }),
    });
    if (!createRes.ok) throw new Error(`Create exec failed: ${await createRes.text()}`);
    const { Id: execId } = (await createRes.json()) as { Id: string };

    // Start exec and get output
    const startRes = await this.fetch(`/exec/${execId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Detach: false, Tty: false }),
    });
    if (!startRes.ok) throw new Error(`Start exec failed: ${await startRes.text()}`);

    const raw = new Uint8Array(await startRes.arrayBuffer());
    return this.stripDockerStreamHeader(raw);
  }

  private stripDockerStreamHeader(raw: Uint8Array): string {
    // Docker multiplexed stream: each frame has 8-byte header [type(1) padding(3) size(4)]
    const decoder = new TextDecoder();
    let offset = 0;
    let output = "";
    while (offset + 8 <= raw.length) {
      const size = (raw[offset + 4]! << 24) | (raw[offset + 5]! << 16) | (raw[offset + 6]! << 8) | raw[offset + 7]!;
      offset += 8;
      if (offset + size <= raw.length) {
        output += decoder.decode(raw.slice(offset, offset + size));
      }
      offset += size;
    }
    return output;
  }

  async getArchive(containerId: string, path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await this.fetch(
      `/containers/${containerId}/archive?path=${encodeURIComponent(path)}`
    );
    if (!res.ok) throw new Error(`getArchive failed: ${await res.text()}`);
    if (!res.body) throw new Error("getArchive: no response body");
    return res.body;
  }

  async putArchive(containerId: string, path: string, tar: ReadableStream<Uint8Array> | ArrayBuffer): Promise<void> {
    const res = await this.fetch(
      `/containers/${containerId}/archive?path=${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/x-tar" },
        body: tar,
      }
    );
    if (!res.ok) throw new Error(`putArchive failed: ${await res.text()}`);
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
