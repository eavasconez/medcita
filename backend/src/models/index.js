const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Doctor = sequelize.define('Doctor', {
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING }
});

const Patient = sequelize.define('Patient', {
  name: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: false }
});

const Appointment = sequelize.define('Appointment', {
  date: { type: DataTypes.DATEONLY, allowNull: false },
  time: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'scheduled' }
});

Doctor.hasMany(Appointment);
Appointment.belongsTo(Doctor);

Patient.hasMany(Appointment);
Appointment.belongsTo(Patient);

module.exports = { Doctor, Patient, Appointment, sequelize };
