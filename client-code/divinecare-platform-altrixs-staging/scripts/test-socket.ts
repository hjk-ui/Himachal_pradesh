import net from 'net';

function test(host: string, port: number) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(3000);
    s.on('connect', () => {
      console.log(`Connected to ${host}:${port}`);
      s.destroy();
      resolve(true);
    });
    s.on('error', (err) => {
      console.log(`Failed ${host}:${port}: ${err.message}`);
      resolve(false);
    });
    s.on('timeout', () => {
      console.log(`Timeout ${host}:${port}`);
      s.destroy();
      resolve(false);
    });
    s.connect(port, host);
  });
}

async function main() {
  await test('127.0.0.1', 5433);
  await test('localhost', 5433);
  await test('::1', 5433);
}

main();
