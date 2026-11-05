import { describe, expect, it } from "vitest";
import { validateOrganizationUrl, SAFE_FETCH_REDIRECT } from "../agent/lib/security/orgUrl.js";

describe("organizationUrl", () => {
  it("acepta dev.azure.com/org", () => {
    const v = validateOrganizationUrl("https://dev.azure.com/ExampleOrg/");
    expect(v.organizationUrl).toBe("https://dev.azure.com/ExampleOrg");
    expect(v.organization).toBe("ExampleOrg");
  });

  it("acepta visualstudio.com", () => {
    const v = validateOrganizationUrl("https://exampleorg.visualstudio.com");
    expect(v.hostStyle).toBe("visualstudio");
  });

  it("rechaza hosts arbitrarios y http", () => {
    expect(() => validateOrganizationUrl("http://dev.azure.com/ExampleOrg")).toThrow(/HTTPS/);
    expect(() => validateOrganizationUrl("https://evil.com/dev.azure.com/ExampleOrg")).toThrow(/no permitida/);
    expect(() => validateOrganizationUrl("https://dev.azure.com/ExampleOrg/project")).toThrow(/sin rutas/);
    expect(() => validateOrganizationUrl("https://user:pass@dev.azure.com/ExampleOrg")).toThrow(/credenciales/);
  });

  it("fetch usa redirect error", () => {
    expect(SAFE_FETCH_REDIRECT).toBe("error");
  });
});
