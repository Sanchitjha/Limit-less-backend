const { Client } = require('ssh2');

const HOST = '160.153.179.249', USER = 'homeubuntu', PASS = 'hoC@BvP6!fl2J@Sc';
const REMOTE_ENV_PATH = '/var/www/html/limitless-backend/.env';

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
  console.log('[SSH] Connected to VPS. Updating .env file...');
  try {
    // 1. Read remote .env file
    const catRes = await exec(conn, `cat ${REMOTE_ENV_PATH}`);
    let content = catRes.stdout;
    
    if (!content) {
      throw new Error(`Could not read remote .env file: ${catRes.stderr}`);
    }

    console.log('[SSH] Current remote .env loaded.');

    // 2. Perform replacement
    console.log('[SSH] Replacing SMTP configuration with new credentials...');
    content = content.replace(/SMTP_HOST=.*/g, 'SMTP_HOST=smtp.gmail.com');
    content = content.replace(/SMTP_PORT=.*/g, 'SMTP_PORT=587');
    content = content.replace(/SMTP_SECURE=.*/g, 'SMTP_SECURE=false');
    content = content.replace(/SMTP_USER=.*/g, 'SMTP_USER=limitlessnet4@gmail.com');
    content = content.replace(/SMTP_PASS=.*/g, 'SMTP_PASS=mtbjcsxocjmnqgpn');
    content = content.replace(/EMAIL_FROM=.*/g, 'EMAIL_FROM=limitlessnet4@gmail.com');

    // 3. Write updated content back to VPS using a temporary file or heredoc
    // To avoid issues with special characters, we transfer using ssh2's SFTP
    conn.sftp(async (err, sftp) => {
      if (err) throw err;
      const writeStream = sftp.createWriteStream(REMOTE_ENV_PATH);
      writeStream.on('close', async () => {
        console.log('[SSH] Remote .env updated successfully.');

        // 4. Restart via PM2
        console.log('[SSH] Restarting limitless-backend via PM2...');
        const pm2Res = await exec(conn, `export PATH=/home/homeubuntu/.nvm/versions/node/v22.22.2/bin:$PATH && pm2 restart limitless-backend`);
        console.log(pm2Res.stdout || pm2Res.stderr);

        conn.end();
      });
      writeStream.on('error', (e) => {
        console.error('[SFTP Write Error]', e);
        conn.end();
      });
      writeStream.write(content);
      writeStream.end();
    });

  } catch (e) {
    console.error('[ERROR]', e.message);
    conn.end();
  }
}).on('error', (err) => {
  console.error('[SSH connection error]', err);
}).connect({ host: HOST, username: USER, password: PASS });
