const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = '160.153.179.249', USER = 'homeubuntu', PASS = 'hoC@BvP6!fl2J@Sc';
const REMOTE_BASE = '/var/www/html/limitless-backend';
const LOCAL_BASE = __dirname;

function md5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, e.name);
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'logs', 'uploads'].includes(e.name)) continue;
      out.push(...walk(full, rel));
    } else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.json') || e.name.endsWith('.cjs') || e.name === '.env')) {
      out.push({ rel, full, md5: md5(full) });
    }
  }
  return out;
}

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
  console.log('[SSH] Connected to VPS for Limitless deploy...');
  try {
    const localFiles = [
      ...walk(path.join(LOCAL_BASE, 'src'), 'src/'),
      { rel: 'package.json', full: path.join(LOCAL_BASE, 'package.json'), md5: md5(path.join(LOCAL_BASE, 'package.json')) },
      { rel: 'ecosystem.config.cjs', full: path.join(LOCAL_BASE, 'ecosystem.config.cjs'), md5: md5(path.join(LOCAL_BASE, 'ecosystem.config.cjs')) },
      { rel: '.env', full: path.join(LOCAL_BASE, '.env'), md5: md5(path.join(LOCAL_BASE, '.env')) },
    ];
    console.log(`[local] Found ${localFiles.length} files to check`);

    // Ensure remote folders exist
    await exec(conn, `sudo mkdir -p ${REMOTE_BASE}/src && sudo chown -R homeubuntu:homeubuntu ${REMOTE_BASE}`);

    console.log('[SFTP] Starting file comparison & upload...');
    conn.sftp(async (err, sftp) => {
      if (err) throw err;

      for (const lf of localFiles) {
        const rp = `${REMOTE_BASE}/${lf.rel}`;
        
        // Ensure parent folder of file exists remotely
        if (lf.rel.includes('/')) {
          const rDir = rp.substring(0, rp.lastIndexOf('/'));
          await exec(conn, `mkdir -p ${rDir}`);
        }

        console.log(`[SFTP] Uploading ${lf.rel} -> ${rp}`);
        await new Promise((res, rej) => {
          const rs = fs.createReadStream(lf.full);
          const ws = sftp.createWriteStream(rp);
          ws.on('close', res).on('error', rej);
          rs.pipe(ws);
        });
      }

      console.log('[SSH] Installing npm dependencies on VPS...');
      const installRes = await exec(conn, `cd ${REMOTE_BASE} && npm install --omit=dev`);
      console.log(installRes.stdout || installRes.stderr);

      console.log('[SSH] Starting/restarting Limitless backend via PM2...');
      const pm2Res = await exec(conn, `export PATH=/home/homeubuntu/.nvm/versions/node/v22.22.2/bin:$PATH && cd ${REMOTE_BASE} && pm2 restart limitless-backend || pm2 start ecosystem.config.cjs`);
      console.log(pm2Res.stdout || pm2Res.stderr);

      console.log('[SSH] Verifying PM2 process list...');
      const listRes = await exec(conn, `export PATH=/home/homeubuntu/.nvm/versions/node/v22.22.2/bin:$PATH && pm2 list`);
      console.log(listRes.stdout);

      console.log('✅ Limitless Backend Deployment Completed successfully!');
      conn.end();
    });

  } catch (e) {
    console.error('[DEPLOY ERROR]', e.message);
    conn.end();
  }
}).connect({ host: HOST, username: USER, password: PASS });
