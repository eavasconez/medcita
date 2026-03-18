const { PrismaClient } = require('@prisma/client');
const { format, parseISO, addMinutes } = require('date-fns');

const prisma = new PrismaClient();

async function fillToday() {
  console.log('--- Starting Fill Today Script ---');
  
  try {
    // 1. Find the target doctor (Try current user first, then demo)
    let doctor = await prisma.doctor.findFirst({
      where: { 
        OR: [
          { email: 'hugo@test.com' },
          { name: 'Hugo Manosalvas' },
          { email: 'demo@medcita.ec' }
        ]
      }
    });

    if (!doctor) {
      console.log('Specific doctor not found, picking the first available doctor...');
      doctor = await prisma.doctor.findFirst();
    }

    if (!doctor) {
      console.error('No doctors found in database.');
      return;
    }

    console.log(`Target Doctor: ${doctor.name} (${doctor.email})`);

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const dayOfWeek = new Date().getDay();

    // 2. Get availability for today
    const availabilities = await prisma.availability.findMany({
      where: { 
        doctorId: doctor.id,
        dayOfWeek: dayOfWeek
      }
    });

    if (availabilities.length === 0) {
      console.log(`No availability set for today (Day ${dayOfWeek}). Adding temporary 8-6 availability...`);
      availabilities.push({
        startTime: '08:00',
        endTime: '18:00'
      });
    }

    // 3. Get or create dummy patients
    let patients = await prisma.patient.findMany({ take: 5 });
    if (patients.length === 0) {
      console.log('Creating dummy patients...');
      await prisma.patient.createMany({
        data: [
          { name: 'Test Patient 1', phone: '+593000000101', cedula: '0000000001' },
          { name: 'Test Patient 2', phone: '+593000000102', cedula: '0000000002' },
          { name: 'Test Patient 3', phone: '+593000000103', cedula: '0000000003' }
        ]
      });
      patients = await prisma.patient.findMany();
    }

    // 4. Generate and create appointments
    console.log(`Filling appointments for ${todayStr}...`);
    const SLOT_DURATION = 30;
    let count = 0;

    for (const avail of availabilities) {
      let current = parseISO(`${todayStr}T${avail.startTime}`);
      const end = parseISO(`${todayStr}T${avail.endTime}`);

      while (current < end) {
        const timeStr = format(current, 'HH:mm');
        
        // Check if slot already occupied
        const existing = await prisma.appointment.findFirst({
          where: {
            doctorId: doctor.id,
            date: todayStr,
            time: timeStr
          }
        });

        if (!existing) {
          const randomPatient = patients[Math.floor(Math.random() * patients.length)];
          
          await prisma.appointment.create({
            data: {
              date: todayStr,
              time: timeStr,
              doctorId: doctor.id,
              patientId: randomPatient.id,
              status: Math.random() > 0.5 ? 'confirmed' : 'scheduled',
              notes: 'Cita autogenerada para prueba de carga.'
            }
          });
          count++;
        }
        
        current = addMinutes(current, SLOT_DURATION);
      }
    }

    console.log(`DONE! Successfully created ${count} appointments for today.`);
    console.log('Calendar should now look completely full (orange/disabled in picker).');

  } catch (err) {
    console.error('Error filling today:', err);
  } finally {
    await prisma.$disconnect();
  }
}

fillToday();
