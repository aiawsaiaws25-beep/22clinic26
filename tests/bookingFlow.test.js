const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], { cwd: root, env });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Test server startup timed out: ${output}`));
    }, 10000);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ child, url: match[0] });
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited (${code}): ${output}`));
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

test('HTTP booking flow and database persistence', { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lakeside-http-'));
  const env = { ...process.env, PORT: '0', DB_PATH: path.join(directory, 'nested', 'test.db') };
  let server;
  const booking = {
    specialty: 'ENT',
    doctor: 'Dr Synthetic Test',
    appointmentDateTime: '2099-06-10T10:30',
    patientName: 'Synthetic Patient',
    patientPhone: '+971501234567',
    patientEmail: 'synthetic@example.com',
  };
  const submit = (values) => fetch(`${server.url}/book`, {
    method: 'POST', body: new URLSearchParams(values),
  });
  const storedBookings = () => {
    const result = spawnSync(process.execPath, ['-e', `
      const service = require('./services/appointmentService');
      console.log(JSON.stringify(service.getBookingsByDate('2099-06-10')));
      require('./data/db').close();
    `], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    server = await startServer(env);
    await t.test('landing page, shared navigation, stylesheet and booking page load', async () => {
      const response = await fetch(server.url);
      assert.equal(response.status, 200);
      const html = await response.text();
      for (const id of ['home', 'specialties', 'about', 'contact']) {
        assert.ok(html.includes(`id="${id}"`));
        assert.ok(html.includes(`href="/#${id}"`));
      }
      assert.match(html, /href="\/book"/);
      const stylesheet = await fetch(`${server.url}/css/site.css`);
      assert.equal(stylesheet.status, 200);
      assert.match(await stylesheet.text(), /position: sticky/);
      const form = await fetch(`${server.url}/book`);
      assert.equal(form.headers.get('cache-control'), 'no-store');
      assert.match(await form.text(), /Confirm booking/);
    });
    await t.test('confirms submitted details and stores defaults', async () => {
      const response = await submit(booking);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.match(html, /Your appointment is booked/);
      for (const value of ['Synthetic Patient', 'Dr Synthetic Test', 'synthetic@example.com', 'Booked', 'Dubai, UTC+04:00']) {
        assert.ok(html.includes(value));
      }
      const rows = storedBookings();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].appointmentDateTime, '2099-06-10T10:30:00+04:00');
      assert.equal(rows[0].status, 'Booked');
      assert.ok(Number.isFinite(Date.parse(rows[0].createdAt)));
    });
    await t.test('invalid submissions show errors and do not save', async () => {
      for (const patch of [
        { specialty: 'Unknown' }, { doctor: '' }, { patientName: ' ' },
        { patientEmail: 'invalid' }, { patientPhone: 'abc' },
        { appointmentDateTime: '2099-02-30T10:00' },
        { appointmentDateTime: '2000-01-01T09:00' },
      ]) {
        const response = await submit({ ...booking, ...patch });
        assert.equal(response.status, 422, JSON.stringify(patch));
        assert.match(await response.text(), /role="alert"/);
      }
      assert.equal(storedBookings().length, 1);
    });
    await t.test('empty and repeated fields are rejected', async () => {
      assert.equal((await submit({})).status, 422);
      const values = new URLSearchParams(booking);
      values.append('patientName', 'Duplicate field');
      assert.equal((await submit(values)).status, 422);
      assert.equal(storedBookings().length, 1);
    });
    await t.test('confirmation renders user text rather than HTML', async () => {
      const response = await submit({ ...booking, patientName: '<b>Synthetic</b>', patientEmail: 'markup@example.com' });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('&lt;b&gt;Synthetic&lt;/b&gt;'));
      assert.ok(!html.includes('<b>Synthetic</b>'));
    });
    await t.test('all four specialties can be booked', async () => {
      for (const specialty of ['General Physician', 'ENT', 'Dentist', 'Cardiologist']) {
        assert.equal((await submit({ ...booking, specialty })).status, 200);
      }
      assert.equal(storedBookings().length, 6);
    });
    await t.test('unknown routes and unsupported methods do not create bookings', async () => {
      assert.equal((await fetch(`${server.url}/missing`)).status, 404);
      assert.equal((await fetch(`${server.url}/book`, { method: 'PUT' })).status, 404);
      assert.equal(storedBookings().length, 6);
    });
    await t.test('request size limit returns an explicit error without saving', async () => {
      const response = await submit({ ...booking, patientName: 'x'.repeat(11000) });
      assert.equal(response.status, 413);
      assert.match(await response.text(), /Unable to process your request/);
      assert.equal(storedBookings().length, 6);
    });
    await t.test('bookings survive a server restart', async () => {
      const before = storedBookings();
      await stopServer(server.child);
      server = await startServer(env);
      assert.equal((await fetch(`${server.url}/book`)).status, 200);
      assert.deepEqual(storedBookings(), before);
    });
  } finally {
    if (server) await stopServer(server.child);
    rmSync(directory, { recursive: true });
  }
});
