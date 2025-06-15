import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Run ts-node with proper ES module support
const child = spawn('npx', ['tsx', 'src/jobs/index.ts'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '--loader tsx/esm' }
});

child.on('close', (code) => {
  console.log(`Jobs process exited with code ${code}`);
  process.exit(code);
});

child.on('error', (error) => {
  console.error('Failed to start jobs process:', error);
  process.exit(1);
}); 