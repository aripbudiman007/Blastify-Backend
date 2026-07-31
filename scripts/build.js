const { spawn } = require('child_process');

const start = Date.now();
const tscBin = require.resolve('typescript/bin/tsc');
const tsc = spawn(process.execPath, [tscBin], { stdio: 'inherit' });

const heartbeat = setInterval(() => {
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`[build] still compiling... ${elapsed}s elapsed`);
}, 10000);

tsc.on('exit', (code) => {
  clearInterval(heartbeat);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[build] tsc finished in ${elapsed}s (exit code ${code})`);
  process.exit(code ?? 1);
});
