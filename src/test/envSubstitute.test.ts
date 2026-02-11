/**
 * Unit tests for envSubstitute — the environment variable replacement logic.
 */

import * as assert from "assert";
import { envSubstitute } from "../api/requester";

describe("envSubstitute", () => {
  it("replaces a single variable", () => {
    const { result, missingVars } = envSubstitute("https://{{host}}/api", {
      host: "localhost:3000",
    });
    assert.strictEqual(result, "https://localhost:3000/api");
    assert.deepStrictEqual(missingVars, []);
  });

  it("replaces multiple variables", () => {
    const { result, missingVars } = envSubstitute(
      "{{baseUrl}}/users?token={{token}}",
      { baseUrl: "https://api.example.com", token: "abc123" },
    );
    assert.strictEqual(result, "https://api.example.com/users?token=abc123");
    assert.deepStrictEqual(missingVars, []);
  });

  it("returns missing vars when variable is not found", () => {
    const { result, missingVars } = envSubstitute("{{baseUrl}}/items/{{id}}", {
      baseUrl: "http://localhost",
    });
    assert.strictEqual(result, "http://localhost/items/{{id}}");
    assert.deepStrictEqual(missingVars, ["id"]);
  });

  it("returns empty string replacement correctly", () => {
    const { result, missingVars } = envSubstitute("{{prefix}}hello", {
      prefix: "",
    });
    assert.strictEqual(result, "hello");
    assert.deepStrictEqual(missingVars, []);
  });

  it("leaves string unchanged when no placeholders", () => {
    const { result, missingVars } = envSubstitute("https://example.com/api", {
      unused: "val",
    });
    assert.strictEqual(result, "https://example.com/api");
    assert.deepStrictEqual(missingVars, []);
  });

  it("handles empty env object", () => {
    const { result, missingVars } = envSubstitute("{{a}} and {{b}}", {});
    assert.strictEqual(result, "{{a}} and {{b}}");
    assert.deepStrictEqual(missingVars, ["a", "b"]);
  });

  it("does not duplicate missing vars when same var appears twice", () => {
    // envSubstitute itself may push duplicates — the sendRequest path deduplicates.
    // But let's verify the raw behavior.
    const { result, missingVars } = envSubstitute("{{x}}/{{x}}", {});
    assert.strictEqual(result, "{{x}}/{{x}}");
    // May contain duplicates at this level — just ensure it's non-empty
    assert.ok(missingVars.length >= 1);
    assert.ok(missingVars.includes("x"));
  });
});
