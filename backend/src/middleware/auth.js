const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// A token is only as good as the account it was issued for: it stops working if
// the account was deleted or if the password changed after the token was issued
// (changing or resetting a password signs every other session out). That takes
// one lookup by primary key per request.
//
// `iat` has a resolution of one second, so the change time is compared at that
// resolution too: the token handed out right after a password change carries
// the same second and must stay valid.
const issuedBeforePasswordChange = (iat, passwordChangedAt) =>
  Boolean(passwordChangedAt) && typeof iat === 'number' && iat < Math.floor(passwordChangedAt.getTime() / 1000);

module.exports = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: decoded.id },
      select: { passwordChangedAt: true }
    });
    if (!doctor || issuedBeforePasswordChange(decoded.iat, doctor.passwordChangedAt)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (err) {
    // A database problem is not a bad token: answering 401 would log everyone out.
    console.error('Auth lookup error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }

  req.doctorId = decoded.id;
  req.userRole = decoded.role;
  next();
};
