const { execSync } = require('child_process');

const run = (cmd) => execSync(cmd, { cwd: __dirname, stdio: 'inherit' });

run('npm install');
run('npm run build');
