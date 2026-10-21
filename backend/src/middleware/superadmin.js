// The platform operator: someone who looks after MedCita itself rather than a
// clinic. Clinic admins are not one, and neither role can do the other's job.
module.exports = (req, res, next) => {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Access denied. Platform admin rights required.' });
  }
  next();
};
