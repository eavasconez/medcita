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
      // Atomically claim the appointment (only succeeds if it's still
      // 'scheduled') before sending anything, so an overlapping cron run
      // or a manual trigger can't both read the same row and send a
      // duplicate reminder.
      const claim = await prisma.appointment.updateMany({
        where: { id: apt.id, status: 'scheduled' },
        data: { status: 'confirmed' }
      });
      if (claim.count === 0) {
        // Another invocation already claimed and is handling this one.
        continue;
      }

      // Send reminder via service (WhatsApp + Email)
      await sendReminder(apt);
      console.log(`Reminder sent to ${apt.patient.name}`);
    }

    console.log('Reminder task completed successfully');
  } catch (error) {
    console.error('Error in reminder task:', error);
    throw error;
  }
};

module.exports = { sendReminders };
