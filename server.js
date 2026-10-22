const express = require('express');
const path = require('node:path');
const appointmentService = require('./services/appointmentService');

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

const clinic = {
  name: 'Lakeside Medical Clinic',
  area: 'JLT, Dubai',
  tagline: 'Expert care, close to home.',
  address: 'Cluster X, JLT, Dubai',
  phone: '+971 4 XXX XXXX',
  hours: 'Mon-Sat, 9am-9pm',
  author: '[Your name]',
};

app.get('/', (req, res) => {
  res.render('index', { clinic });
});

app.get('/book', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('booking', { clinic, specialties: appointmentService.specialties, values: {}, error: null });
});

app.post('/book', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const booking = appointmentService.createBooking(req.body);
    res.render('confirmation', { clinic, booking });
  } catch (error) {
    if (error instanceof appointmentService.BookingValidationError) {
      return res.status(422).render('booking', {
        clinic, specialties: appointmentService.specialties, values: req.body || {}, error: error.message,
      });
    }
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error('Clinic request failed:', error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).type('text').send('Unable to process your request. Please try again or contact reception.');
});

module.exports = app;

// Vercel imports the app as a serverless function; only listen when run directly.
if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`Clinic website running at http://localhost:${server.address().port}`);
  });

  server.on('error', (error) => {
    console.error('Unable to start the clinic website:', error);
    process.exitCode = 1;
  });
}
