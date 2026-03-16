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

  // Default availability for demo doctor (Mon-Fri 08:00-18:00)
  const days = [1, 2, 3, 4, 5];
  await prisma.availability.createMany({
    data: days.map(day => ({
      dayOfWeek: day,
      startTime: '08:00',
      endTime: '18:00',
      doctorId: doctor.id
    }))
  });

  // Create Patients with Cedula
  const p1 = await prisma.patient.create({
    data: { name: 'Juan Carlos Cevallos', phone: '+593987654321', cedula: '1723456789', email: 'juan@example.com' },
  });

  const p2 = await prisma.patient.create({
    data: { name: 'María Elena Lasso', phone: '+593900000001', cedula: '1712344321', email: 'maria@example.com' },
  });

  const p3 = await prisma.patient.create({
    data: { name: 'Erick Vasconez', phone: '+593985729425', cedula: '1755667788' },
  });

  await prisma.appointment.createMany({
    data: [
      {
        date: '2026-03-20',
        time: '10:00',
        doctorId: doctor.id,
        patientId: p1.id,
        status: 'scheduled',
      },
      {
        date: '2026-03-21',
        time: '14:30',
        doctorId: doctor.id,
        patientId: p2.id,
        status: 'scheduled',
      }
    ],
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
