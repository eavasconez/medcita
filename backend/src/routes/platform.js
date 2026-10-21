const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const superadmin = require('../middleware/superadmin');
const { parsePagination, pageInfo } = require('../utils/pagination');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Platform operators only. They see the clinics and how big each one is, never
// the patients or appointments inside them.
router.use(superadmin);

router.get('/clinics', async (req, res) => {
  const paging = parsePagination(req.query, { defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE });
  if (paging.error) return res.status(400).json({ error: paging.error });
  const { page, pageSize, skip } = paging;

  try {
    const [clinics, total] = await Promise.all([
      prisma.clinic.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          createdAt: true,
          _count: { select: { doctors: true, patients: true, appointments: true } }
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: pageSize
      }),
      prisma.clinic.count()
    ]);
    res.json({ clinics, ...pageInfo({ total, page, pageSize }) });
  } catch (err) {
    console.error('List clinics error:', err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

module.exports = router;
