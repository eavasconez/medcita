const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.appointment.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.doctor.deleteMany();

  const hashedDoctorPass = await bcrypt.hash('demo1234', 10);
  const hashedAdminPass = await bcrypt.hash('admin1234', 10);

  // Create Admin
  const admin = await prisma.doctor.upsert({
    where: { email: 'admin@medcita.ec' },
    update: {},
    create: {
      email: 'admin@medcita.ec',
      name: 'Administrador MedCita',
      password: hashedAdminPass,
      role: 'admin'
    },
  });

  // Create Demo Doctor
  const doctor = await prisma.doctor.upsert({
    where: { email: 'demo@medcita.ec' },
    update: {},
    create: {
      email: 'demo@medcita.ec',
      name: 'Dr. Santiago Pérez',
      password: hashedDoctorPass,
      role: 'doctor'
    },
  });

  const doctors = [admin, doctor];
  const days = [1, 2, 3, 4, 5]; // Mon to Fri

  for (const doc of doctors) {
    await prisma.availability.deleteMany({ where: { doctorId: doc.id } });
    await prisma.availability.createMany({
      data: days.map(day => ({
        dayOfWeek: day,
        startTime: '08:00',
        endTime: '18:00',
        doctorId: doc.id
      }))
    });
  }

  // Create Patients
  const patientsCount = await prisma.patient.count();
  if (patientsCount === 0) {
    await prisma.patient.createMany({
      data: [
        { name: 'Juan Carlos Cevallos', phone: '+593987654321', cedula: '1723456789', email: 'juan@example.com' },
        { name: 'María Elena Lasso', phone: '+593900000001', cedula: '1712344321', email: 'maria@example.com' },
        { name: 'Ricardo Andrade', phone: '+593985729425', cedula: '1755667788', email: 'ricardo@example.com' },
        { name: 'Hugo Paez', phone: '+593911111111', cedula: '1799999999' }
      ]
    });
  }

  const allPatients = await prisma.patient.findMany();
  
  // Create multiple appointments to show colors
  const todayStr = new Date().toISOString().split('T')[0];
  
  await prisma.appointment.createMany({
    data: [
      { date: todayStr, time: '09:00', doctorId: doctor.id, patientId: allPatients[0].id, status: 'scheduled' },
      { date: todayStr, time: '10:00', doctorId: doctor.id, patientId: allPatients[1].id, status: 'confirmed' },
      { date: todayStr, time: '14:00', doctorId: doctor.id, patientId: allPatients[2].id, status: 'scheduled' },
      { date: todayStr, time: '16:30', doctorId: doctor.id, patientId: allPatients[3].id, status: 'scheduled' }
    ]
  });

  console.log('Seed completed successfully');
  console.log('Admin: admin@medcita.ec / admin1234');
  console.log('Doctor: demo@medcita.ec / demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
