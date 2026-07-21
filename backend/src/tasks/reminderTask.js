const prisma = require('../config/prisma');
const { sendReminder } = require('../services/notificationService');
const { format, addDays } = require('date-fns');

const REMINDER_WINDOW_HOURS = 24;

/**
 * Task to send appointment reminders ~24h before each appointment.
 * Runs hourly and picks up any 'scheduled' appointment that has crossed
 * into the 24h window since the last run, so each one is reminded once,
 * close to 24h out, rather than all at once "the day before".
 */
const sendReminders = async () => {
  console.log('Running reminder task...');

  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');

  try {
    // Appointments happening today or tomorrow are the only ones that can
    // fall within the next 24h, so this keeps the query narrow without
    // needing a real datetime column.
    const appointments = await prisma.appointment.findMany({
      where: {
        date: { in: [todayStr, tomorrowStr] },
        status: 'scheduled'
      },
      include: {
        patient: true,
        doctor: true
      }
    });

    const due = appointments.filter((apt) => {
      const appointmentAt = new Date(`${apt.date}T${apt.time}:00`);
      const hoursUntil = (appointmentAt - now) / (1000 * 60 * 60);
      return hoursUntil > 0 && hoursUntil <= REMINDER_WINDOW_HOURS;
    });

    console.log(`Found ${due.length} appointment(s) within ${REMINDER_WINDOW_HOURS}h`);

    for (const apt of due) {
      // Send reminder via service (WhatsApp + Email)
      await sendReminder(apt);

      // Mark as 'confirmed' so this same appointment isn't reminded again
      // on the next hourly run.
      await prisma.appointment.update({
        where: { id: apt.id },
        data: { status: 'confirmed' }
      });
      console.log(`Reminder sent to ${apt.patient.name}`);
    }

    console.log('Reminder task completed successfully');
  } catch (error) {
    console.error('Error in reminder task:', error);
  }
};

module.exports = { sendReminders };
