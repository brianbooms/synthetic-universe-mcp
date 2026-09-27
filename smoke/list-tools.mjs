// Smoke test: spawn the built server over stdio, call ListTools, verify schemas.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: [new URL("../dist/index.js", import.meta.url).pathname],
  // Pass the full environment so the spawned server inherits proxy vars
  // (the SDK's default stdio spawn only inherits a minimal safe list).
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tool count:", tools.length);
let fail = 0;
const expected = {
  get_weather: ["lat", "lon"],
  get_iss_passes: ["lat", "lon"],
  summarize_webpage: ["url"],
  get_webpage_markdown: ["url"],
  convert_fx: ["from", "to", "amount?"],
  parse_feed: ["url"],
};
for (const [name, params] of Object.entries(expected)) {
  const t = tools.find((x) => x.name === name);
  if (!t) { console.log("MISSING:", name); fail++; continue; }
  const props = Object.keys(t.inputSchema?.properties ?? {});
  const req = t.inputSchema?.required ?? [];
  const want = params.map((p) => p.replace("?", ""));
  const wantReq = params.filter((p) => !p.endsWith("?"));
  const okProps = want.every((p) => props.includes(p)) && props.includes("x402_payment");
  const okReq = wantReq.every((p) => req.includes(p));
  const hasPrice = (t.description ?? "").includes("$0.01");
  console.log(`${okProps && okReq && hasPrice ? "OK  " : "FAIL"} ${name} params=[${props}] required=[${req}] price_in_desc=${hasPrice}`);
  if (!(okProps && okReq && hasPrice)) fail++;
}
await client.close();
console.log(fail === 0 ? "SMOKE PASS" : `SMOKE FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
