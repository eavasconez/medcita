// The text a patient is shown before agreeing to the processing of their health data.
// DRAFT written by the developers: a lawyer has to review it before real patients are
// asked to sign it (see docs/legal/puntos-para-el-abogado.md).
//
// `version` identifies this exact wording. Change the text => change the version: every
// consent already given stays tied to the version the patient actually read, and the
// app shows those patients as "out of date" until they agree to the new one.
//
// `{{clinic}}` is replaced with the name of the clinic that asks.
const HEALTH_DATA_CONSENT = {
  kind: 'health_data',
  version: '2026-10-v1',
  title: 'Consentimiento para el tratamiento de datos de salud',
  paragraphs: [
    'Yo autorizo a {{clinic}} (el «consultorio») a tratar mis datos personales, incluidos mis datos de salud, en los términos de este documento.',
    '**Qué datos.** Mis datos de identificación y contacto (nombre, cédula, teléfono, correo), mis citas y, cuando el consultorio los registre, los datos de mi atención de salud.',
    '**Para qué.** Para agendarme y recordarme citas, atenderme y llevar el registro de mi atención. Mis datos no se usan para publicidad ni se venden.',
    '**Quién accede.** El personal autorizado del consultorio, según su función. MedCita, la plataforma que usa el consultorio, los guarda y procesa por cuenta de este, y no los usa para fines propios.',
    '**Mensajes.** Podré recibir recordatorios y confirmaciones de mis citas por WhatsApp y correo electrónico.',
    '**Dónde se guardan.** En servidores de proveedores tecnológicos ubicados fuera de Ecuador (Estados Unidos, entre otros), con las medidas de seguridad descritas en la política de privacidad.',
    '**Cuánto tiempo.** El que exija la normativa de conservación de la historia clínica y, para los demás datos, mientras sean necesarios para las finalidades indicadas.',
    '**Mis derechos.** Puedo pedir acceso a mis datos, su rectificación, su eliminación cuando proceda, oponerme a su tratamiento o pedir su portabilidad, escribiendo al consultorio.',
    '**Retirar mi consentimiento.** Puedo retirarlo en cualquier momento, sin que eso afecte la atención de salud que necesite. El retiro no afecta al tratamiento hecho antes, y el consultorio podrá conservar lo que la ley le obligue a conservar.'
  ]
};

const CONSENT_METHODS = ['in_person_signed', 'in_person_verbal', 'electronic', 'other'];

// The text for a clinic, with its name filled in
function consentDocumentFor(clinicName) {
  const name = clinicName || 'el consultorio';
  return {
    kind: HEALTH_DATA_CONSENT.kind,
    version: HEALTH_DATA_CONSENT.version,
    title: HEALTH_DATA_CONSENT.title,
    paragraphs: HEALTH_DATA_CONSENT.paragraphs.map((paragraph) => paragraph.replaceAll('{{clinic}}', name))
  };
}

module.exports = { HEALTH_DATA_CONSENT, CONSENT_METHODS, CURRENT_CONSENT_VERSION: HEALTH_DATA_CONSENT.version, consentDocumentFor };
