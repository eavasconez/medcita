// Upper bound on skip/offset - well beyond any real list, but keeps a bogus/huge
// page number from producing an expensive scan or an offset outside what
// Postgres/Prisma can sanely handle.
const MAX_SKIP = 1_000_000;

// Reads ?page and ?pageSize. Returns { page, pageSize, skip } or { error } with
// the message to send back in a 400. pageSize is clamped to maxPageSize.
function parsePagination(query, { defaultPageSize, maxPageSize }) {
  const page = query.page !== undefined ? Number(query.page) : 1;
  if (!Number.isInteger(page) || page < 1) {
    return { error: 'page must be a positive integer' };
  }

  const pageSizeInput = query.pageSize !== undefined ? Number(query.pageSize) : defaultPageSize;
  if (!Number.isInteger(pageSizeInput) || pageSizeInput < 1) {
    return { error: 'pageSize must be a positive integer' };
  }
  const pageSize = Math.min(maxPageSize, pageSizeInput);

  if ((page - 1) * pageSize > MAX_SKIP) {
    return { error: 'page is out of range' };
  }
  return { page, pageSize, skip: (page - 1) * pageSize };
}

const pageInfo = ({ total, page, pageSize }) => ({
  total,
  page,
  pageSize,
  totalPages: Math.max(1, Math.ceil(total / pageSize))
});

module.exports = { parsePagination, pageInfo };
