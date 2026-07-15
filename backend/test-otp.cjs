const { Client } = require('ssh2');

const HOST = '160.153.179.249', USER = 'homeubuntu', PASS = 'hoC@BvP6!fl2J@Sc';

const conn = new Client();
conn.on('ready', () => {
  console.log('[SSH] Connected for OTP verification test...');
  conn.exec('curl -s -X POST http://localhost:4000/api/auth/send-otp -H "Content-Type: application/json" -d @- -w "\n[%{http_code}]\n"', (err, stream) => {
    if (err) {
      console.error(err);
      conn.end();
      return;
    }
    stream.on('close', () => {
      conn.end();
    });
    stream.on('data', (d) => {
      process.stdout.write(d.toString());
    });
    stream.stderr.on('data', (d) => {
      process.stderr.write(d.toString());
    });
    
    // Write JSON to stdin of curl
    stream.write(JSON.stringify({ email: 'localcheck@limitless-check.com' }));
    stream.end();
  });
}).on('error', (err) => {
  console.error('[SSH error]', err);
}).connect({ host: HOST, username: USER, password: PASS });
