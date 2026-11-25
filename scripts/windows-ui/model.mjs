// @env node
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";

const modelId = "pilot-desktop-fixture";

function completion(response, id, input) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const write = (delta, finishReason = null) => {
    const chunk = {
      id,
      object: "chat.completion.chunk",
      created: 1,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    response.write("data: " + JSON.stringify(chunk) + "\n\n");
  };
  write({ role: "assistant" });
  return {
    input,
    write,
    finish(reason = "stop") {
      write({}, reason);
      response.end("data: [DONE]\n\n");
    },
  };
}

export async function startModelFixture() {
  const pending = [];
  const received = new EventEmitter();
  let completionCount = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: modelId, object: "model" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(input.model, modelId);
      assert.equal(input.stream, true);
      pending.push(completion(response, "fixture-" + ++completionCount, input));
      received.emit("completion");
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    baseUrl: "http://127.0.0.1:" + server.address().port + "/v1",
    modelId,
    async nextCompletion() {
      if (!pending.length)
        await once(received, "completion", { signal: AbortSignal.timeout(15_000) });
      return pending.shift();
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
