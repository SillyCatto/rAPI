/**
 * Unit tests for the requester module — specifically sendRequest with a mock server.
 */

import * as assert from "assert";
import * as http from "http";
import { sendRequest } from "../api/requester";
import type { Environment, RequestSpec } from "../types";

describe("sendRequest", () => {
  let server: http.Server;
  let port: number;

  before((done) => {
    server = http.createServer((req, res) => {
      // Echo endpoint — returns request info as JSON
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const response = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body || null,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      done();
    });
  });

  after((done) => {
    server.close(done);
  });

  it("sends a GET request and returns RequestResult", async () => {
    const spec: RequestSpec = {
      id: "test-1",
      name: "Test GET",
      method: "GET",
      url: `http://localhost:${port}/hello`,
    };

    const { result, missingVars } = await sendRequest(spec);

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.statusText, "OK");
    assert.ok(result.durationMs >= 0);
    assert.ok(result.bodyJson);
    assert.strictEqual(result.bodyJson.method, "GET");
    assert.strictEqual(result.bodyJson.url, "/hello");
    assert.deepStrictEqual(missingVars, []);
  });

  it("sends a POST request with body", async () => {
    const spec: RequestSpec = {
      id: "test-2",
      name: "Test POST",
      method: "POST",
      url: `http://localhost:${port}/data`,
      body: '{"key":"value"}',
    };

    const { result } = await sendRequest(spec);

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.bodyJson.method, "POST");
    assert.strictEqual(result.bodyJson.body, '{"key":"value"}');
  });

  it("applies environment variable substitution", async () => {
    const spec: RequestSpec = {
      id: "test-3",
      name: "Test Env",
      method: "GET",
      url: "{{base}}/envtest",
    };

    const env: Environment = {
      name: "test-env",
      values: { base: `http://localhost:${port}` },
    };

    const { result, missingVars } = await sendRequest(spec, env);

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.bodyJson.url, "/envtest");
    assert.deepStrictEqual(missingVars, []);
  });

  it("reports missing environment variables", async () => {
    const spec: RequestSpec = {
      id: "test-4",
      name: "Test Missing Env",
      method: "GET",
      url: `http://localhost:${port}/{{missingPath}}`,
    };

    const env: Environment = {
      name: "test-env",
      values: {},
    };

    const { result, missingVars } = await sendRequest(spec, env);

    // Request still goes out (with unresolved placeholder in URL path)
    assert.strictEqual(result.status, 200);
    assert.ok(missingVars.includes("missingPath"));
  });

  it("measures durationMs correctly", async () => {
    const spec: RequestSpec = {
      id: "test-5",
      name: "Test Duration",
      method: "GET",
      url: `http://localhost:${port}/`,
    };

    const { result } = await sendRequest(spec);
    assert.ok(typeof result.durationMs === "number");
    assert.ok(result.durationMs >= 0);
    assert.ok(result.durationMs < 5000); // Should be fast against localhost
  });
});
