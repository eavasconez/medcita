const express = require('express');
const prisma = require('../config/prisma');
const clinicalAccess = require('../middleware/clinicalAccess');
const diagnoses = require('../services/diagnoses');

// The ICD-10 list the diagnoses of a note are picked from (S10-05). It is the same list for every
// clinic and holds no patient data, so reading it is not audited; it is still for doctors and
// admins only, like everything a consultation note uses (mounted behind the auth middleware).
const router = express.Router();
router.use(clinicalAccess);

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Search by code ("E11") or by words of the name ("diabetes tipo 2"), accents and case ignored.
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < MIN_QUERY_LENGTH) return res.status(400).json({ error: `q must have at least ${MIN_QUERY_LENGTH} characters` });
  const limit = req.query.limit === undefined ? DEFAULT_LIMIT : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return res.status(400).json({ error: `limit must be a whole number between 1 and ${MAX_LIMIT}` });
  }

  try {
    res.json(await diagnoses.search(prisma, q, limit));
  } catch (err) {
    console.error('Search diagnoses error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Whether the list has been loaded, so the screen can say so instead of "no results".
router.get('/status', async (req, res) => {
  try {
    const groups = await prisma.diagnosisCode.groupBy({ by: ['source', 'version'], _count: { _all: true } });
    res.json({
      loaded: groups.reduce((total, group) => total + group._count._all, 0),
      sources: groups.map((group) => ({ source: group.source, version: group.version, codes: group._count._all }))
    });
  } catch (err) {
    console.error('Diagnoses status error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
