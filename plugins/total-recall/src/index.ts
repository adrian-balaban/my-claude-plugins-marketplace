// Total-recall MCP server entry point.
//
// Server setup (schemas + dispatch) and main() live in ./server.js; the 12 tool
// implementations live under ./tools/*.js; shared in-memory state lives in
// ./state.js. This file just boots the server and flushes pending writes on exit.
//
// Importing ./server.js is load-bearing: its module body constructs the Server,
// registers the ListTools/CallTool handlers, and exports main(). The test suite
// drives the server by importing this file and invoking the captured handlers.

import { main } from './server.js';
import { flushPending } from './persistence.js';

process.once('SIGTERM', () => { flushPending(); process.exit(0); });
process.once('SIGINT', () => { flushPending(); process.exit(0); });
process.on('beforeExit', flushPending);

main().catch(e => { console.error(e); process.exit(1); });