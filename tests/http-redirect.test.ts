import { describe, expect, it } from "vitest";
import { createHttpAzureClient } from "../agent/lib/azure/client.js";

describe("http client redirect:error", () => {
  it("pasa redirect error en fetch", async () => {
    let seen: RequestRedirect | undefined;
    const fakeFetch: typeof fetch = async (_url, init) => {
      seen = init?.redirect as RequestRedirect;
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    };
    const client = createHttpAzureClient(
      {
        organizationUrl: "https://dev.azure.com/ExampleOrg",
        project: "Example Project",
        pat: "synthetic-pat-http-test",
      },
      fakeFetch,
    );
    await client.probePermissions();
    expect(seen).toBe("error");
  });

  it("uploadAttachment envía bytes binarios", async () => {
    let body: BodyInit | null | undefined;
    let contentType: string | null = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      body = init?.body ?? null;
      const h = init?.headers as Record<string, string>;
      contentType = h?.["Content-Type"] ?? null;
      return new Response(JSON.stringify({ id: "1", url: "https://dev.azure.com/ExampleOrg/_apis/wit/attachments/1" }), {
        status: 201,
      });
    };
    const client = createHttpAzureClient(
      {
        organizationUrl: "https://dev.azure.com/ExampleOrg",
        project: "Example Project",
        pat: "synthetic-pat-http-test",
      },
      fakeFetch,
    );
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await client.uploadAttachment("a.png", "image/png", bytes);
    expect(contentType).toBe("image/png");
    expect(body).toBeInstanceOf(Uint8Array);
    expect((body as Uint8Array).length).toBe(5);
  });
});
