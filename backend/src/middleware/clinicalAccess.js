const prisma = require('../config/prisma');

// Who may read and write the clinical record (notes, diagnoses, history, vital signs):
// the doctors and the admins of the clinic. The secretary books appointments and never
// sees what was said in the consultation. The clinic boundary itself comes from
// req.clinicId, as in every other route (utils/clinicScope.js).
const CLINICAL_ROLES = ['doctor', 'admin'];

// The role of the token is whatever it was when the token was issued, and a token lasts
// hours. For clinical data that is too long: a doctor moved to the front desk, or an
// account that was just deleted, must lose access at once. So the role is read again
// from the account on every clinical request (one lookup by primary key).
module.exports = async (req, res, next) => {
  let account;
  try {
    account = await prisma.doctor.findFirst({
      where: { id: req.doctorId, clinicId: req.clinicId },
      select: { role: true }
    });
  } catch (err) {
    console.error('Clinical access lookup error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }

  if (!account || !CLINICAL_ROLES.includes(account.role)) {
    return res.status(403).json({ error: 'Access denied. Clinical data is not available to your role.' });
  }
  req.userRole = account.role;
  next();
};

module.exports.CLINICAL_ROLES = CLINICAL_ROLES;
