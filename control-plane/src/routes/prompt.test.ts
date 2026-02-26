import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { promptRoutes } from "./prompt";

describe("prompt routes", () => {
  let app: Hono;

  beforeEach(() => {
    const db = createDb(":memory:");
    app = new Hono();
    app.route("/api/prompt", promptRoutes(db));
  });

  it("GET returns empty when no prompt set", async () => {
    const res = await app.request("/api/prompt");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.content).toBe("");
  });

  it("PUT saves a prompt and GET retrieves it", async () => {
    const putRes = await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Build a web scraper" }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/api/prompt");
    const body = (await getRes.json()) as any;
    expect(body.content).toBe("Build a web scraper");
  });

  it("PUT returns previous version in response", async () => {
    await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v1" }),
    });

    const res = await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v2" }),
    });
    const body = (await res.json()) as any;
    expect(body.previous).toBe("v1");
    expect(body.current).toBe("v2");
  });

  it("PUT rejects empty content", async () => {
    const res = await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });
});
