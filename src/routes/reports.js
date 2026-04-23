import { Router } from "express";
import { stringify } from "csv-stringify/sync";
import { db } from "../db.js";

export const reportsRouter = Router();

function buildTransactionFilter(query) {
  const { from, to, pageId, status, paymentMethod } = query;
  const where = [];
  const params = [];

  if (from) {
    where.push("t.created_at >= ?");
    params.push(String(from));
  }
  if (to) {
    where.push("t.created_at <= ?");
    params.push(String(to));
  }
  if (pageId) {
    where.push("t.page_id = ?");
    params.push(String(pageId));
  }
  if (status) {
    where.push("t.status = ?");
    params.push(String(status));
  }
  if (paymentMethod) {
    where.push("t.payment_method = ?");
    params.push(String(paymentMethod));
  }

  return {
    whereClause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

async function queryTransactions(query) {
  const { whereClause, params } = buildTransactionFilter(query);
  return db.all(
    `SELECT t.*, p.title AS page_title, p.slug AS page_slug
     FROM transactions t
     JOIN payment_pages p ON p.id = t.page_id
     ${whereClause}
     ORDER BY t.created_at DESC`,
    params,
  );
}

reportsRouter.get("/transactions", async (req, res, next) => {
  try {
    const rows = await queryTransactions(req.query);
    return res.json(
      rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        paymentMethod: r.payment_method,
        status: r.status,
        payerName: r.payer_name,
        payerEmail: r.payer_email,
        processorRef: r.processor_ref,
        glCodes: JSON.parse(r.gl_codes_json || "[]"),
        createdAt: r.created_at,
        page: { id: r.page_id, title: r.page_title, slug: r.page_slug },
      })),
    );
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/summary", async (req, res, next) => {
  try {
    const totals = await db.get(
      `SELECT COUNT(*) AS total_count,
              SUM(CASE WHEN status='success' THEN amount ELSE 0 END) AS total_amount,
              AVG(CASE WHEN status='success' THEN amount END) AS avg_amount
       FROM transactions`,
    );

    const byMethod = await db.all(
      `SELECT payment_method, COUNT(*) AS count, SUM(amount) AS total
       FROM transactions
       WHERE status='success'
       GROUP BY payment_method`,
    );

    const byGl = await db.all(
      `SELECT gl_codes_json, amount, status
       FROM transactions
       WHERE status='success'`,
    );

    const glMap = new Map();
    for (const row of byGl) {
      const codes = JSON.parse(row.gl_codes_json || "[]");
      for (const code of codes) {
        const current = glMap.get(code) || { count: 0, totalAmount: 0 };
        current.count += 1;
        current.totalAmount += Number(row.amount || 0);
        glMap.set(code, current);
      }
    }

    return res.json({
      totalPayments: Number(totals.total_count || 0),
      totalAmountCollected: Number(totals.total_amount || 0),
      averagePaymentAmount: Number(totals.avg_amount || 0),
      byPaymentMethod: byMethod.map((m) => ({
        method: m.payment_method,
        count: Number(m.count || 0),
        totalAmount: Number(m.total || 0),
      })),
      byGlCode: Array.from(glMap.entries()).map(([code, values]) => ({
        code,
        ...values,
      })),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/transactions.csv", async (req, res, next) => {
  try {
    const rows = await queryTransactions(req.query);
    const csvRows = rows.map((r) => ({
      id: r.id,
      page_slug: r.page_slug,
      amount: r.amount,
      payment_method: r.payment_method,
      status: r.status,
      payer_name: r.payer_name,
      payer_email: r.payer_email,
      processor_ref: r.processor_ref,
      created_at: r.created_at,
    }));
    const csv = stringify(csvRows, { header: true });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=transactions.csv");
    return res.send(csv);
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/insights", async (_req, res, next) => {
  try {
    const totals = await db.get(
      `SELECT
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successful_transactions,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_transactions,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_transactions,
        SUM(CASE WHEN status='success' THEN amount ELSE 0 END) AS revenue
       FROM transactions`,
    );
    const views = await db.get("SELECT COUNT(*) AS total_views FROM page_views");
    const pages = await db.get("SELECT COUNT(*) AS total_pages FROM payment_pages");

    const trend = await db.all(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS transaction_count,
              SUM(CASE WHEN status='success' THEN amount ELSE 0 END) AS revenue
       FROM transactions
       WHERE created_at >= datetime('now', '-14 day')
       GROUP BY substr(created_at, 1, 10)
       ORDER BY day ASC`,
    );

    const pagePerformance = await db.all(
      `SELECT p.id, p.title, p.slug,
              COUNT(DISTINCT v.id) AS view_count,
              COUNT(DISTINCT t.id) AS transaction_count,
              SUM(CASE WHEN t.status='success' THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN t.status='success' THEN t.amount ELSE 0 END) AS revenue
       FROM payment_pages p
       LEFT JOIN page_views v ON v.page_id = p.id
       LEFT JOIN transactions t ON t.page_id = p.id
       GROUP BY p.id, p.title, p.slug
       ORDER BY revenue DESC`,
    );

    const totalViews = Number(views.total_views || 0);
    const totalTx = Number(totals.total_transactions || 0);
    const successfulTx = Number(totals.successful_transactions || 0);

    return res.json({
      overview: {
        totalPages: Number(pages.total_pages || 0),
        totalViews,
        totalTransactions: totalTx,
        successfulTransactions: successfulTx,
        failedTransactions: Number(totals.failed_transactions || 0),
        pendingTransactions: Number(totals.pending_transactions || 0),
        revenue: Number(totals.revenue || 0),
      },
      funnel: {
        viewed: totalViews,
        checkoutStarted: totalTx,
        successful: successfulTx,
        viewToCheckoutRate: totalViews ? totalTx / totalViews : 0,
        checkoutToSuccessRate: totalTx ? successfulTx / totalTx : 0,
      },
      trend: trend.map((t) => ({
        day: t.day,
        transactionCount: Number(t.transaction_count || 0),
        revenue: Number(t.revenue || 0),
      })),
      pagePerformance: pagePerformance.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        viewCount: Number(p.view_count || 0),
        transactionCount: Number(p.transaction_count || 0),
        successCount: Number(p.success_count || 0),
        revenue: Number(p.revenue || 0),
      })),
    });
  } catch (err) {
    next(err);
  }
});
