const db = require('../data/db');

const specialties = ['General Physician', 'ENT', 'Dentist', 'Cardiologist'];

class BookingValidationError extends Error {}

const statements = {
  create: db.prepare(`INSERT INTO appointments
    (specialty, doctor, appointmentDateTime, patientName, patientPhone, patientEmail)
    VALUES (?, ?, ?, ?, ?, ?)`),
  byId: db.prepare('SELECT * FROM appointments WHERE id = ?'),
  byEmail: db.prepare('SELECT * FROM appointments WHERE patientEmail = ? COLLATE NOCASE ORDER BY appointmentDateTime, id'),
  byDate: db.prepare('SELECT * FROM appointments WHERE substr(appointmentDateTime, 1, 10) = ? ORDER BY appointmentDateTime, id'),
  update: db.prepare('UPDATE appointments SET status = ? WHERE id = ?'),
};

function text(value, label, maximum = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new BookingValidationError(`${label} is required and must be at most ${maximum} characters.`);
  }
  return value.trim();
}

function emailAddress(value) {
  const email = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BookingValidationError('Enter a valid email address.');
  }
  return email;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function createBooking(input) {
  if (!input || typeof input !== 'object') {
    throw new BookingValidationError('Booking details are required.');
  }
  const specialty = text(input.specialty, 'Specialty');
  if (!specialties.includes(specialty)) {
    throw new BookingValidationError('Choose one of the listed specialties.');
  }
  const doctor = text(input.doctor, 'Doctor');
  const patientName = text(input.patientName, 'Patient name');
  const patientPhone = text(input.patientPhone, 'Phone', 30);
  if (!/^\+?[\d ()-]{7,30}$/.test(patientPhone) || patientPhone.replace(/\D/g, '').length < 7) {
    throw new BookingValidationError('Enter a valid phone number with at least seven digits.');
  }
  const patientEmail = emailAddress(input.patientEmail);
  const localDateTime = text(input.appointmentDateTime, 'Appointment date and time', 16);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(localDateTime)
    || !validDate(localDateTime.slice(0, 10))) {
    throw new BookingValidationError('Enter a valid appointment date and time.');
  }
  const appointmentDateTime = `${localDateTime}:00+04:00`;
  if (Date.parse(appointmentDateTime) <= Date.now()) {
    throw new BookingValidationError('Choose a future appointment date and time (Dubai time).');
  }
  const result = statements.create.run(specialty, doctor, appointmentDateTime, patientName, patientPhone, patientEmail);
  return statements.byId.get(result.lastInsertRowid);
}

function getBookingsByEmail(email) {
  return statements.byEmail.all(emailAddress(email));
}

function getBookingsByDate(date) {
  if (!validDate(date)) {
    throw new BookingValidationError('Enter a valid date in YYYY-MM-DD format.');
  }
  return statements.byDate.all(date);
}

function updateStatus(id, status) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new BookingValidationError('A positive booking ID is required.');
  }
  const value = text(status, 'Status', 40);
  const result = statements.update.run(value, id);
  if (result.changes === 0) {
    throw new BookingValidationError('Booking not found.');
  }
  return statements.byId.get(id);
}

module.exports = { createBooking, getBookingsByEmail, getBookingsByDate, updateStatus, specialties, BookingValidationError };
