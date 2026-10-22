const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('appointment service saves, finds, validates and updates bookings', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lakeside-test-'));
  const previousPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(directory, 'nested', 'appointments.db');
  const service = require('../services/appointmentService');
  const input = {
    specialty: 'ENT',
    doctor: "Dr Test O'Brien",
    appointmentDateTime: '2099-06-10T10:30',
    patientName: "Test O'Brien",
    patientPhone: '+971 50 123 4567',
    patientEmail: 'TEST@example.com',
  };
  try {
    let booking;
    await t.test('creates a custom database directory and persists all fields', () => {
      booking = service.createBooking(input);
      assert.ok(existsSync(process.env.DB_PATH));
      assert.ok(Number.isSafeInteger(booking.id));
      assert.equal(booking.specialty, input.specialty);
      assert.equal(booking.doctor, input.doctor);
      assert.equal(booking.patientName, input.patientName);
      assert.equal(booking.patientPhone, input.patientPhone);
      assert.equal(booking.patientEmail, 'test@example.com');
      assert.equal(booking.appointmentDateTime, '2099-06-10T10:30:00+04:00');
      assert.equal(booking.status, 'Booked');
      assert.ok(Number.isFinite(Date.parse(booking.createdAt)));
    });
    await t.test('looks up email case-insensitively and by Dubai calendar date', () => {
      assert.equal(service.getBookingsByEmail('TEST@example.com')[0].id, booking.id);
      assert.equal(service.getBookingsByDate('2099-06-10')[0].id, booking.id);
      assert.deepEqual(service.getBookingsByDate('2099-06-11'), []);
      assert.deepEqual(service.getBookingsByEmail('nobody@example.com'), []);
    });
    await t.test('prepared queries treat SQL-like input as data', () => {
      assert.deepEqual(service.getBookingsByEmail("x'OR'1'='1@example.com"), []);
      assert.equal(service.getBookingsByEmail('test@example.com')[0].patientName, input.patientName);
    });
    await t.test('updates only the requested booking', () => {
      const other = service.createBooking({ ...input, patientEmail: 'other@example.com' });
      assert.equal(service.updateStatus(booking.id, 'Cancelled').status, 'Cancelled');
      assert.equal(service.getBookingsByEmail('other@example.com')[0].status, 'Booked');
      assert.notEqual(other.id, booking.id);
      assert.throws(() => service.updateStatus(99999, 'Cancelled'), /not found/);
    });
    await t.test('rejects invalid input without creating bookings', () => {
      for (const patch of [
        { specialty: 'Unknown' }, { doctor: '' }, { patientName: '' },
        { patientEmail: 'invalid' }, { patientPhone: 'abc' },
        { appointmentDateTime: '2099-02-30T10:00' },
        { appointmentDateTime: '2099-06-10T25:00' },
        { appointmentDateTime: '2000-01-01T10:00' },
      ]) {
        assert.throws(() => service.createBooking({ ...input, ...patch }), service.BookingValidationError);
      }
      assert.throws(() => service.getBookingsByDate('2099-02-30'), service.BookingValidationError);
      assert.throws(() => service.updateStatus(booking.id, ''), service.BookingValidationError);
      assert.throws(() => service.updateStatus('1 OR 1=1', 'Cancelled'), service.BookingValidationError);
      assert.equal(service.getBookingsByDate('2099-06-10').length, 2);
    });
  } finally {
    require('../data/db').close();
    if (previousPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousPath;
    rmSync(directory, { recursive: true });
  }
});
