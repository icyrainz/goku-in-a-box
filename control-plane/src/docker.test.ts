// control-plane/src/docker.test.ts
import { describe, it, expect } from "bun:test";
import { DockerClient } from "./docker";

describe("DockerClient", () => {
  it("constructs with default socket path", () => {
    const client = new DockerClient();
    expect(client.socketPath).toBe("/var/run/docker.sock");
  });

  it("constructs with custom socket path", () => {
    const client = new DockerClient("/custom/docker.sock");
    expect(client.socketPath).toBe("/custom/docker.sock");
  });

  it("builds correct create container payload", () => {
    const client = new DockerClient();
    const payload = client.buildCreatePayload({
      image: "goku-sandbox:latest",
      name: "goku-sandbox",
      env: ["FOO=bar"],
      binds: ["/host:/container"],
    });
    expect(payload.Image).toBe("goku-sandbox:latest");
    expect(payload.Env).toContain("FOO=bar");
    expect(payload.HostConfig.Binds).toContain("/host:/container");
  });
});
