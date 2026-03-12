const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendWhatsApp } = require('../utils/sms');
const { v4: uuidv4 } = require('uuid');

router.get('/', async (req, res) => {
  try {
    const appointments = db.get('appointments')
      .filter({ doctorId: req.doctorId })
      .value();
    
    // Fill in patient data
    const fullAppointments = appointments.map(apt => {
      const patient = db.get('patients').find({ id: apt.patientId }).value();
      return { ...apt, Patient: patient };
    });

    res.json(fullAppointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { patientName, patientPhone, date, time } = req.body;
  try {
    let patient = db.get('patients').find({ phone: patientPhone }).value();
    if (!patient) {
      patient = { id: uuidv4(), name: patientName, phone: patientPhone };
      db.get('patients').push(patient).write();
    }

    const appointment = {
      id: uuidv4(),
      date,
      time,
      patientId: patient.id,
      doctorId: req.doctorId,
      status: 'scheduled'
    };

    db.get('appointments').push(appointment).write();

    // Send WhatsApp
    const message = `Hola ${patientName}, tu cita en MedCita ha sido confirmada para el ${date} a las ${time}. ¡Te esperamos!`;
    await sendWhatsApp(patientPhone, message);

    res.status(201).json({ ...appointment, Patient: patient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
