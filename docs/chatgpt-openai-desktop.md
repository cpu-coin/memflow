# ChatGPT / OpenAI Desktop Connector

MemFlow can generate a ChatGPT developer-mode connector draft for the remote MCP endpoint and keep the CPUcoin icon and full logo bundled with the install files.

## Start The MCP Server

Run MemFlow as an HTTP-streaming MCP server:

```bash
npx memflow mcp --transport httpStream --port 8080
```

If you are publishing the endpoint behind HTTPS, point ChatGPT at the public URL instead of the local port.

## Generate The Connector Draft

```bash
npx memflow connect:chatgpt
```

This writes a draft connector package to `~/.memflow/integrations/chatgpt.json` and copies the CPU icon and full CPUcoin logo into the same folder.

If you want to use an explicit remote endpoint, set:

```bash
export MEMFLOW_CHATGPT_MCP_URL="https://your-host.example/mcp"
```

Then rerun `npx memflow connect:chatgpt`.

## Import Into ChatGPT

1. Open ChatGPT.
2. Enable Developer Mode in Apps / Connectors settings.
3. Import or create the remote MCP connector using the generated URL.
4. Confirm the connector is visible in a new chat.

## What Success Looks Like

- The connector draft exists.
- The MCP URL is reachable over HTTPS.
- ChatGPT shows MemFlow as available in developer mode.
- Prompt start output can say that MemFlow is on and connected.
