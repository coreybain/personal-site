#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ManagementBackend } from './backend.js';
import { ConfigurationError, readConfig } from './config.js';
import { createServer } from './server.js';

try {
  const server = createServer(new ManagementBackend(readConfig()));
  await server.connect(new StdioServerTransport());
} catch (error) {
  // stdout belongs exclusively to the MCP JSON-RPC transport.
  process.stderr.write(`Home MCP: ${error instanceof ConfigurationError ? error.message : 'Unable to start the management server.'}\n`);
  process.exitCode = 1;
}
