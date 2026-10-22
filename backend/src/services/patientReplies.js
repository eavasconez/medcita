// What happens when a patient taps a button of the WhatsApp reminder (S9-02): «Confirmo»,
// «Cancelar» or «Cambiar hora». Meta tells us through the webhook (routes/webhooks.js).
//
// The tap is tied to ONE appointment by the signed payload of the button (whatsappButtons.js),
// and acted on only when all of this holds, otherwise it is written down and changes nothing:
//
//   - the payload is ours, and about the visit as it is now (not one that was moved since);
//   - it comes from the patient's own number (a reminder forwarded to a friend must not let the
//     friend cancel it);
//   - the visit is still ahead and still open (not cancelled, attended, or missed);
//   - it is not a repeat: Meta sends again what it did not see answered, and patients tap twice.
//
// Every message that belongs to an appointment leaves a row in the message history
// (NotificationLog, status "received"), which is also how a repeat is recognised by its Meta id.
// Confirming or cancelling is also written in the audit log, as the patient.

const prisma = require('../config/prisma');
const notificationService = require('./notificationService');
const emailService = require('./emailService');
const { parseButtonPayload, stampOf } = require('./whatsappButtons');
const { recordPatientAction, diffFields } = require('./auditLog');
const { appointmentInstant } = require('../utils/clinicTime');
const { runSerializableTransaction } = require('../utils/serializableTransaction');
const { frontendLink } = require('../utils/tokens');
const { maskPhone } = require('../utils/mask');

// A visit that can still be confirmed, cancelled or moved; the first two have not been confirmed yet
const OPEN_STATUSES = ['pending_approval', 'scheduled', 'confirmed'];
const HOUR = 60 * 60 * 1000;
// A second «Cambiar hora» within this time does not bother the staff again
const RESCHEDULE_NOTICE_COOLDOWN_HOURS = 24;

// What the message history says for each thing that happened. A tap that changed nothing is
// "patient_reply_ignored", and its errorCode says why.
const KIND = {
  confirmed: 'patient_confirmed',
  cancelled: 'patient_cancelled',
  reschedule_requested: 'patient_reschedule_request'
};
const IGNORED_KIND = 'patient_reply_ignored';

const digitsOf = (phone) => String(phone ?? '').replace(/\D/g, '');

// The same WhatsApp number written two ways: with and without the country code or the leading 0
// ("0991234567" is "593991234567"). Meta always sends the full number; a clinic may have typed it either way.
function samePhone(a, b) {
  const [first, second] = [digitsOf(a), digitsOf(b)];
  if (!first || !second) return false;
  if (first === second) return true;
  const [short, long] = first.length <= second.length ? [first, second] : [second, first];
  const local = short.replace(/^0+/, '');
  return local.length >= 8 && long.endsWith(local);
}

// The payload of the button the patient tapped (a template's quick reply, or an interactive reply)
const payloadOf = (message) => {
  if (message?.type === 'button') return message.button?.payload;
  if (message?.type === 'interactive') return message.interactive?.button_reply?.id;
  return undefined;
};

// What to do with a tap on `action`, given the visit as it is now. Pure: nothing is read or written.
function decide({ action, appointment, timezone, now }) {
  const { status, date, time } = appointment;
  if (status === 'cancelled') {
    return action === 'cancel' ? { outcome: 'already_cancelled' } : { outcome: 'not_applicable', reason: 'cancelled' };
  }
  if (!OPEN_STATUSES.includes(status)) return { outcome: 'not_applicable', reason: 'closed' };
  if (appointmentInstant(date, time, timezone) <= now) return { outcome: 'not_applicable', reason: 'past' };

  if (action === 'confirm') {
    return status === 'confirmed' ? { outcome: 'already_confirmed' } : { outcome: 'confirmed', nextStatus: 'confirmed' };
  }
  if (action === 'cancel') return { outcome: 'cancelled', nextStatus: 'cancelled' };
  return { outcome: 'reschedule_requested' };
}

// What the patient is told, as free text (they just wrote, so the 24-hour window is open)
const REPLIES = {
  confirmed: ({ name, doctor, date, time }) => `MedCita: ¡Gracias, ${name}! Tu cita con ${doctor} el ${date} a las ${time} quedó confirmada. Te esperamos.`,
  already_confirmed: ({ name, doctor, date, time }) => `MedCita: ${name}, tu cita con ${doctor} el ${date} a las ${time} ya estaba confirmada. Te esperamos.`,
  cancelled: ({ name, doctor, date, time }) => `MedCita: Listo, ${name}. Cancelamos tu cita con ${doctor} del ${date} a las ${time}. Si quieres agendar otra, comunícate con el consultorio.`,
  already_cancelled: ({ name }) => `MedCita: ${name}, tu cita ya estaba cancelada. Si quieres agendar otra, comunícate con el consultorio.`,
  reschedule_requested: ({ name, date, time }) => `MedCita: Recibimos tu solicitud, ${name}. Avisamos al consultorio para que se comunique contigo y elijan otro horario. Hasta entonces, tu cita sigue el ${date} a las ${time}.`,
  reschedule_repeated: ({ name }) => `MedCita: ${name}, ya avisamos al consultorio que necesitas otro horario. Se comunicarán contigo.`,
  not_applicable: () => 'MedCita: Esta cita ya no admite cambios por WhatsApp. Si necesitas ayuda, comunícate con el consultorio.',
  stale: () => 'MedCita: Este mensaje corresponde a un horario anterior de tu cita. Revisa tu recordatorio más reciente o comunícate con el consultorio.'
};

// Why a tap changed nothing, as the history keeps it (errorCode of a "patient_reply_ignored" row);
// a "not_applicable" or "other_number" outcome brings its own reason
const IGNORED_REASON = { already_confirmed: 'already_confirmed', already_cancelled: 'already_cancelled', reschedule_repeated: 'repeated', stale: 'stale' };

// Tells the clinic's admins and secretaries that a patient needs another time, by email.
async function notifyStaff({ appointment, patient, doctor, clinic }) {
  const staff = await prisma.doctor.findMany({
    where: { clinicId: clinic.id, role: { in: ['admin', 'secretary'] } },
    select: { name: true, email: true }
  });
  const { date, time } = appointment;
  const text = [
    `${patient.name} (${patient.phone}) pidió cambiar su cita con ${doctor.name} del ${date} a las ${time}, tocando «Cambiar hora» en el recordatorio de WhatsApp.`,
    '',
    'Comunícate con el paciente para elegir otro horario y mueve la cita desde la agenda.'
  ].join('\n');

  await Promise.allSettled(
    staff.map((person) =>
      notificationService.sendEmail(
        person.email,
        'Un paciente pidió cambiar su cita - MedCita',
        text,
        emailService.templates.rescheduleRequestHtml({
          staffName: person.name,
          patientName: patient.name,
          patientPhone: patient.phone,
          doctorName: doctor.name,
          clinicName: clinic.name,
          date,
          time,
          url: frontendLink('/dashboard')
        }),
        { kind: 'reschedule_request_notice', recipient: 'user', clinicId: clinic.id, appointmentId: appointment.id }
      )
    )
  );
}

/**
 * Handles one message of the webhook. Resolves to { outcome, followUp }: `outcome` says what
 * was decided (for the logs and the tests), and `followUp` is what is left to send once the
 * decision is saved (the answer to the patient, the notice to the staff), or null.
 * It throws only when the database fails, so Meta is told to send the message again.
 */
async function handleMessage(message, { origin = {}, now = new Date() } = {}) {
  const from = String(message?.from ?? '');
  const parsed = parseButtonPayload(payloadOf(message));
  if (!parsed) {
    // Free text, a photo, a made-up or an old payload: nothing says which appointment it is about, and
    // answering strangers would invite loops with other bots. Only the log (never the text) remembers it.
    console.log(`[WHATSAPP REPLY] ignored a ${message?.type ?? 'unknown'} message from ${maskPhone(from)}: not a button of ours`);
    return { outcome: 'ignored', followUp: null };
  }

  const result = await runSerializableTransaction(async (tx) => {
    if (message.id) {
      const seen = await tx.notificationLog.findFirst({
        where: { appointmentId: parsed.appointmentId, status: 'received', providerMessageId: String(message.id) },
        select: { id: true }
      });
      if (seen) return { outcome: 'duplicate' };
    }

    const appointment = await tx.appointment.findUnique({
      where: { id: parsed.appointmentId },
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        doctor: { select: { id: true, name: true } },
        clinic: { select: { id: true, name: true, timezone: true } }
      }
    });
    if (!appointment) {
      console.log(`[WHATSAPP REPLY] ignored a button from ${maskPhone(from)}: its appointment does not exist`);
      return { outcome: 'ignored' };
    }

    const remember = (kind, errorCode = null) =>
      tx.notificationLog.create({
        data: {
          clinicId: appointment.clinicId,
          appointmentId: appointment.id,
          kind,
          channel: 'whatsapp',
          provider: 'meta',
          recipient: 'patient',
          status: 'received',
          errorCode,
          providerMessageId: message.id ? String(message.id) : null,
          destination: maskPhone(from)
        }
      });

    // Somebody else's phone (the reminder was forwarded): written down, not answered
    if (!samePhone(from, appointment.patient.phone)) {
      await remember(IGNORED_KIND, 'other_number');
      return { outcome: 'other_number' };
    }
    // A reminder about a visit that was moved since: it must not act on the new one
    if (parsed.stamp !== stampOf(appointment.date, appointment.time)) {
      await remember(IGNORED_KIND, 'stale');
      return { outcome: 'stale', appointment };
    }

    const decision = decide({ action: parsed.action, appointment, timezone: appointment.clinic.timezone, now });
    let { outcome } = decision;

    if (decision.nextStatus) {
      const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { status: decision.nextStatus } });
      await recordPatientAction(tx, {
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        action: outcome === 'cancelled' ? 'cancel' : 'update',
        entityId: appointment.id,
        doctorId: appointment.doctorId,
        changes: diffFields('appointment', appointment, updated),
        origin
      });
    }

    if (outcome === 'reschedule_requested') {
      const earlier = await tx.notificationLog.findFirst({
        where: {
          appointmentId: appointment.id,
          kind: KIND.reschedule_requested,
          createdAt: { gte: new Date(now.getTime() - RESCHEDULE_NOTICE_COOLDOWN_HOURS * HOUR) }
        },
        select: { id: true }
      });
      if (earlier) outcome = 'reschedule_repeated';
    }

    if (KIND[outcome]) await remember(KIND[outcome]);
    else await remember(IGNORED_KIND, decision.reason ?? IGNORED_REASON[outcome]);
    return { outcome, appointment };
  });

  const { outcome, appointment } = result;
  // Duplicates, strangers' numbers and unknown appointments get no answer
  if (!appointment || !REPLIES[outcome]) return { outcome, followUp: null };

  const { patient, doctor, clinic } = appointment;
  const about = { clinicId: appointment.clinicId, appointmentId: appointment.id };
  const text = REPLIES[outcome]({ name: patient.name, doctor: doctor.name, date: appointment.date, time: appointment.time });
  return {
    outcome,
    followUp: async () => {
      await Promise.allSettled([
        notificationService.sendWhatsApp(from, text, null, { ...about, kind: 'patient_reply_answer', recipient: 'patient' }),
        outcome === 'reschedule_requested' ? notifyStaff({ appointment, patient, doctor, clinic }) : null
      ]);
    }
  };
}

/**
 * Handles a whole webhook call from Meta (the parsed JSON body): every message of every
 * change. Resolves to { results, failures }: what was decided for each message, and how many
 * could not be saved (the caller then answers 500 so Meta sends the call again; messages
 * already saved are recognised as repeats). Delivery receipts and other fields are skipped.
 */
async function processWebhook(body, { origin = {}, now } = {}) {
  const results = [];
  let failures = 0;
  const ours = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (change?.field !== 'messages' || !Array.isArray(value?.messages)) continue;
      // The app can be subscribed to several numbers; only the one MedCita sends from is ours
      if (ours && value.metadata?.phone_number_id && String(value.metadata.phone_number_id) !== ours) continue;

      for (const message of value.messages) {
        try {
          results.push(await handleMessage(message, { origin, now }));
        } catch (err) {
          failures += 1;
          console.error('WhatsApp reply could not be processed:', err);
        }
      }
    }
  }
  return { results, failures };
}

module.exports = { samePhone, decide, handleMessage, processWebhook, KIND, IGNORED_KIND, RESCHEDULE_NOTICE_COOLDOWN_HOURS };
