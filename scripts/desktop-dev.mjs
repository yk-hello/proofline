import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: false } });
await server.listen();
const address = server.httpServer.address();
const environment = { ...process.env, MENGX_DEV_URL: `http://127.0.0.1:${address.port}/` };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', windowsHide: true,
  env: environment });
child.on('exit', async (code) => { await server.close(); process.exitCode = code; });
child.on('error', async (error) => { console.error(error); await server.close(); process.exitCode = 1; });
