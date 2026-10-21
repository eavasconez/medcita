const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { checkSeedTarget } = require('../src/utils/seedGuard');
const { ensureDefaultType } = require('../src/services/appointmentTypes');

const prisma = new PrismaClient();

// Builds a YYYY-MM-DD string from local date parts (not toISOString, which is
// UTC and would shift the date in Ecuador's UTC-5 around midnight).
function toLocalDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// Doctors' availability is Mon-Fri only, so demo appointments must land on
// business days - a raw calendar offset (e.g. "+2 days" from a Thursday)
// can land on a Saturday and silently produce an appointment outside any
// configured availability. Returns `count` weekdays starting from `base`
// (inclusive if `base` itself is a weekday).
function nextBusinessDays(base, count) {
  const result = [];
  let d = new Date(base);
  while (result.length < count) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) result.push(new Date(d));
    d = addDays(d, 1);
  }
  return result;
}

async function main() {
  const target = checkSeedTarget(process.env.DATABASE_URL);
  if (!target.ok) throw new Error(target.message);

  // Clear existing data
  await prisma.auditLog.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.signupRequest.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.appointmentType.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.clinic.deleteMany();

  const hashedDoctorPass = await bcrypt.hash('demo1234', 10);
  const hashedAdminPass = await bcrypt.hash('admin1234', 10);

  // The main demo clinic holds the 3 pilot doctors below. A second, separate one
  // (further down) shows that clinics never see each other's data.
  const clinic = await prisma.clinic.create({ data: { name: 'Consultorio MedCita (demo)', slug: 'medcita-demo' } });

  // Create Admin
  const admin = await prisma.doctor.upsert({
    where: { email: 'admin@medcita.ec' },
    update: {},
    create: {
      email: 'admin@medcita.ec',
      name: 'Administrador MedCita',
      password: hashedAdminPass,
      role: 'admin',
      clinicId: clinic.id
    },
  });

  // Create 3 pilot doctors, each with a different specialty so the demo
  // shows variety across the doctor picker / reports.
  const pilotDoctorsData = [
    { email: 'demo@medcita.ec', name: 'Dr. Santiago Pérez', specialty: 'Medicina General' },
    { email: 'dra.torres@medcita.ec', name: 'Dra. Camila Torres', specialty: 'Pediatría' },
    { email: 'dr.mendoza@medcita.ec', name: 'Dr. Andrés Mendoza', specialty: 'Medicina Familiar' }
  ];

  const pilotDoctors = [];
  for (const d of pilotDoctorsData) {
    const doctor = await prisma.doctor.upsert({
      where: { email: d.email },
      update: {},
      create: {
        email: d.email,
        name: d.name,
        password: hashedDoctorPass,
        role: 'doctor',
        specialty: d.specialty,
        clinicId: clinic.id
      },
    });
    pilotDoctors.push(doctor);
  }

  const doctors = [admin, ...pilotDoctors];
  const days = [1, 2, 3, 4, 5]; // Mon to Fri

  for (const doc of doctors) {
    await prisma.availability.deleteMany({ where: { doctorId: doc.id } });
    await prisma.availability.createMany({
      data: days.map(day => ({
        dayOfWeek: day,
        startTime: '08:00',
        endTime: '18:00',
        doctorId: doc.id,
        clinicId: doc.clinicId
      }))
    });
  }

  // Create Patients
  const patientsData = [
    { name: 'Juan Carlos Cevallos', phone: '+593987654321', cedula: '1723456789', email: 'juan@example.com' },
    { name: 'María Elena Lasso', phone: '+593900000001', cedula: '1712344321', email: 'maria@example.com' },
    { name: 'Ricardo Andrade', phone: '+593985729425', cedula: '1755667788', email: 'ricardo@example.com' },
    { name: 'Hugo Paez', phone: '+593911111111', cedula: '1799999999' },
    { name: 'Valentina Salazar', phone: '+593922222222', cedula: '1733445566', email: 'valentina@example.com' },
    { name: 'Diego Fernando Ortiz', phone: '+593933333333', cedula: '1744556677', email: 'diego@example.com' },
    { name: 'Gabriela Noboa', phone: '+593944444444', cedula: '1755443322', email: 'gabriela@example.com' },
    { name: 'Mateo Villacís', phone: '+593955555555', cedula: '1766554433', email: 'mateo@example.com' }
  ];

  await prisma.patient.createMany({ data: patientsData.map(p => ({ ...p, clinicId: clinic.id })) });

  // In the order of patientsData, which the appointment plan below relies on
  const allPatients = await Promise.all(patientsData.map(p =>
    prisma.patient.findUniqueOrThrow({ where: { clinicId_phone: { clinicId: clinic.id, phone: p.phone } } })
  ));

  // The kinds of visit of the demo clinic: the default one (30 min) and two more
  const defaultType = await ensureDefaultType(prisma, clinic.id);
  const firstVisit = await prisma.appointmentType.create({ data: { clinicId: clinic.id, name: 'First visit', durationMinutes: 40, color: '#f97316' } });
  const checkUp = await prisma.appointmentType.create({ data: { clinicId: clinic.id, name: 'Check-up', durationMinutes: 20, color: '#22c55e' } });

  const today = new Date();
  // 3 consecutive business days from today (e.g. Thu/Fri/Mon if today is a
  // Thursday) - indexed 0/1/2 below instead of raw calendar offsets, so a
  // weekend never ends up with a demo appointment nobody's available for.
  const businessDays = nextBusinessDays(today, 3);
  const dateFor = (dayIndex) => toLocalDateStr(businessDays[dayIndex]);

  // A spread of appointments per doctor, across the next 3 business days and
  // across statuses, so the calendar and status filters have something real
  // to show in a demo instead of a single flat list.
  const appointmentPlan = [
    // Dr. Santiago Pérez (Medicina General)
    { doctor: pilotDoctors[0], patient: allPatients[0], dayIndex: 0, time: '09:00', status: 'confirmed', type: firstVisit },
    { doctor: pilotDoctors[0], patient: allPatients[1], dayIndex: 0, time: '10:00', status: 'scheduled', type: checkUp },
    { doctor: pilotDoctors[0], patient: allPatients[2], dayIndex: 0, time: '14:00', status: 'pending_approval' },
    { doctor: pilotDoctors[0], patient: allPatients[3], dayIndex: 1, time: '16:30', status: 'confirmed' },
    // Dra. Camila Torres (Pediatría)
    { doctor: pilotDoctors[1], patient: allPatients[4], dayIndex: 0, time: '09:30', status: 'confirmed', type: firstVisit },
    { doctor: pilotDoctors[1], patient: allPatients[5], dayIndex: 1, time: '11:00', status: 'pending_approval' },
    { doctor: pilotDoctors[1], patient: allPatients[6], dayIndex: 2, time: '15:00', status: 'scheduled', type: checkUp },
    // Dr. Andrés Mendoza (Medicina Familiar)
    { doctor: pilotDoctors[2], patient: allPatients[7], dayIndex: 0, time: '08:30', status: 'scheduled' },
    { doctor: pilotDoctors[2], patient: allPatients[0], dayIndex: 2, time: '13:00', status: 'confirmed' }
  ];

  await prisma.appointment.createMany({
    data: appointmentPlan.map(a => ({
      date: dateFor(a.dayIndex),
      time: a.time,
      doctorId: a.doctor.id,
      patientId: a.patient.id,
      clinicId: clinic.id,
      status: a.status,
      typeId: (a.type || defaultType).id,
      durationMinutes: (a.type || defaultType).durationMinutes
    }))
  });

  // A second clinic with its own people and patients: nothing of it is visible
  // from the clinic above, and nothing above is visible from it.
  const otherClinic = await prisma.clinic.create({ data: { name: 'Clínica Vida (demo)', slug: 'clinica-vida' } });
  const otherAdmin = await prisma.doctor.create({
    data: { email: 'admin@clinicavida.ec', name: 'Administradora Clínica Vida', password: hashedAdminPass, role: 'admin', clinicId: otherClinic.id }
  });
  const otherDoctor = await prisma.doctor.create({
    data: { email: 'dra.vega@clinicavida.ec', name: 'Dra. Paula Vega', password: hashedDoctorPass, role: 'doctor', specialty: 'Ginecología', clinicId: otherClinic.id }
  });
  await prisma.availability.createMany({
    data: [otherAdmin, otherDoctor].flatMap(doc => days.map(day => ({
      dayOfWeek: day, startTime: '08:00', endTime: '18:00', doctorId: doc.id, clinicId: otherClinic.id
    })))
  });
  const otherPatients = await Promise.all([
    { name: 'Lucía Ramírez', phone: '+593966000001', cedula: '1788990011', email: 'lucia@example.com' },
    { name: 'Esteban Cárdenas', phone: '+593966000002', cedula: '1799001122' }
  ].map(data => prisma.patient.create({ data: { ...data, clinicId: otherClinic.id } })));
  const otherDefaultType = await ensureDefaultType(prisma, otherClinic.id);
  await prisma.appointment.createMany({
    data: [
      { patient: otherPatients[0], dayIndex: 0, time: '10:30', status: 'confirmed' },
      { patient: otherPatients[1], dayIndex: 1, time: '15:00', status: 'pending_approval' }
    ].map(a => ({
      date: dateFor(a.dayIndex),
      time: a.time,
      doctorId: otherDoctor.id,
      patientId: a.patient.id,
      clinicId: otherClinic.id,
      status: a.status,
      typeId: otherDefaultType.id
    }))
  });

  // The operator of the platform itself: sees the clinics and their sizes, no patients
  const platformClinic = await prisma.clinic.create({ data: { name: 'MedCita (plataforma)', slug: 'plataforma' } });
  await prisma.doctor.create({
    data: { email: 'plataforma@medcita.ec', name: 'Operador de la plataforma', password: hashedAdminPass, role: 'superadmin', clinicId: platformClinic.id }
  });

  console.log('Seed completed successfully');
  console.log('Admin: admin@medcita.ec / admin1234');
  pilotDoctorsData.forEach(d => console.log(`Doctor (${d.specialty}): ${d.email} / demo1234`));
  console.log('Second clinic: admin@clinicavida.ec / admin1234 and dra.vega@clinicavida.ec / demo1234');
  console.log('Platform operator: plataforma@medcita.ec / admin1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
