#!/usr/bin/env node
// MCP stdio server exposing egg-verify's paid endpoints as tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clientFromEnv } from "./client.js";

const egg = clientFromEnv();
const server = new McpServer({ name: "egg-verify-mcp", version: "0.1.0" });
const out = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e.message || e) }] });

server.tool("verify_claim", "Check a factual claim against one public URL. Costs $0.05 USDC on Base. Returns SUPPORTED/REFUTED/UNCLEAR with verbatim evidence and the settlement tx hash.",
  { claim: z.string().max(500), url: z.string().url() },
  async ({ claim, url }) => { try { return out(await egg.verify(claim, url)); } catch (e) { return fail(e); } });

server.tool("scout", "Summarise up to 3 URLs against a brief, with key points and quotes. Costs $0.50 USDC (needs EGG_MAX_USD >= 0.5).",
  { brief: z.string().max(500), urls: z.array(z.string().url()).min(1).max(3) },
  async ({ brief, urls }) => { try { return out(await egg.scout(brief, urls)); } catch (e) { return fail(e); } });

server.tool("deep_dive", "Cross-source synthesis over up to 8 URLs plus open questions. Costs $2.00 USDC (needs EGG_MAX_USD >= 2).",
  { brief: z.string().max(500), urls: z.array(z.string().url()).min(1).max(8) },
  async ({ brief, urls }) => { try { return out(await egg.deepdive(brief, urls)); } catch (e) { return fail(e); } });

await server.connect(new StdioServerTransport());
