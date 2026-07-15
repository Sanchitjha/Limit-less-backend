const { Client } = require('ssh2');

const HOST = '160.153.179.249', USER = 'homeubuntu', PASS = 'hoC@BvP6!fl2J@Sc';

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('close', () => resolve({ stdout, stderr }))
        .on('data', d => stdout += d.toString())
        .stderr.on('data', d => stderr += d.toString());
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  console.log('[SSH] Connected to VPS.');
  try {
    const cmd = process.argv.slice(2).join(' ') || 'pm2 list';
    console.log(`[SSH] Running command: ${cmd}`);
    const res = await exec(conn, `export PATH=/home/homeubuntu/.nvm/versions/node/v22.22.2/bin:$PATH && ${cmd}`);
    console.log('--- STDOUT ---');
    console.log(res.stdout);
    console.log('--- STDERR ---');
    console.log(res.stderr);
  } catch (e) {
    console.error('[ERROR]', e.message);
  } finally {
    conn.end();
  }
}).on('error', (err) => {
  console.error('[SSH connection error]', err);
}).connect({ host: HOST, username: USER, password: PASS });
