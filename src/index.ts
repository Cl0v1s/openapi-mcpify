#!/usr/bin/env node
import { getRoutes, read } from "./swager"
import { buildMcpTool, buildToolCallback } from "./tool"
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseArgs } from "./cli"

async function main() {
    const { spec, url: baseUrl, defaultArgs } = parseArgs(process.argv.slice(2))

    const openApi = await read(spec)
    const routes = getRoutes(openApi)

    const server = new McpServer({
        name: openApi.info.title,
        version: openApi.info.version,
    });

    for (const route of routes) {
        const tool = buildMcpTool(route)
        server.registerTool(tool.name, tool as any, buildToolCallback(server, baseUrl, route, defaultArgs))
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`OpenApi ${openApi.info.title} MCP Server running on stdio`);
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});