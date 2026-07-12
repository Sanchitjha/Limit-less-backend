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
  console.log('[SSH] Connected to VPS. Reading Nginx configurations...');
  try {
    const files = ['limitless-backend', 'limitless-frontend', 'limitless-model'];
    for (const f of files) {
      console.log(`\n--- /etc/nginx/sites-available/${f} ---`);
      const res = await exec(conn, `cat /etc/nginx/sites-available/${f}`);
      console.log(res.stdout || res.stderr);
    }
    conn.end();
  } catch (e) {
    console.error('[ERROR]', e.message);
    conn.end();
  }
}).on('error', (err) => {
  console.error('[SSH connection error]', err);
}).connect({ host: HOST, username: USER, password: PASS });
