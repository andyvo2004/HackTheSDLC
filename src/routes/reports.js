import { Router } from "express";
import { stringify } from "csv-stringify/sync";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

export const reportsRouter = Router();

function pageInfo(paymentPages) {
  return Array.isArray(paymentPages) ? paymentPages[0] : paymentPages;
}

async function queryTransactions(query) {
  let builder = supabaseAdmin
    .from("transactions")
    .select("*,payment_pages!inner(id,title,slug)")
    .order("created_at", { ascending: false });

  if (query.from) builder = builder.gte("created_at", String(query.from));
  if (query.to) builder = builder.lte("created_at", String(query.to));
  if (query.pageId) builder = builder.eq("page_id", String(query.pageId));
  if (query.status) builder = builder.eq("status", String(query.status));
  if (query.paymentMethod) builder = builder.eq("payment_method", String(query.paymentMethod));

  const { data, error } = await builder;
  if (error) throw error;
  return data || [];
}

reportsRouter.get("/transactions", async (req, res, next) => {
  try {
    const rows = await queryTransactions(req.query);
    return res.json(
      rows.map((r) => {
        const page = pageInfo(r.payment_pages);
        return {
          id: r.id,
          amount: r.amount,
          paymentMethod: r.payment_method,
          status: r.status,
          payerName: r.payer_name,
          payerEmail: r.payer_email,
          processorRef: r.processor_ref,
          glCodes: JSON.parse(r.gl_codes_json || "[]"),
          createdAt: r.created_at,
          page: { id: page?.id, title: page?.title, slug: page?.slug },
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/summary", async (_req, res, next) => {
  try {
    const { data: allTx, error } = await supabaseAdmin
      .from("transactions")
      .select("payment_method,amount,status,gl_codes_json");
    if (error) throw error;
    const tx = allTx || [];
    const successTx = tx.filter((row) => row.status === "success");
    const totalAmount = successTx.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const byMethodMap = new Map();
    for (const row of successTx) {
      const existing = byMethodMap.get(row.payment_method) || { count: 0, totalAmount: 0 };
      existing.count += 1;
      existing.totalAmount += Number(row.amount || 0);
      byMethodMap.set(row.payment_method, existing);
    }

    const glMap = new Map();
    for (const row of successTx) {
      const codes = JSON.parse(row.gl_codes_json || "[]");
      for (const code of codes) {
        const current = glMap.get(code) || { count: 0, totalAmount: 0 };
        current.count += 1;
        current.totalAmount += Number(row.amount || 0);
        glMap.set(code, current);
      }
    }

    return res.json({
      totalPayments: tx.length,
      totalAmountCollected: totalAmount,
      averagePaymentAmount: successTx.length ? totalAmount / successTx.length : 0,
      byPaymentMethod: Array.from(byMethodMap.entries()).map(([method, values]) => ({
        method,
        ...values,
      })),
      byGlCode: Array.from(glMap.entries()).map(([code, values]) => ({ code, ...values })),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get("/transactions.csv", async (req, res, next) => {
  try {
    const rows = await queryTransactions(req.query);
    const csvRows = rows.map((r) => {
      const page = pageInfo(r.payment_pages);
      return {
        id: r.id,
        page_slug: page?.slug,
        amount: r.amount,
        payment_method: r.payment_method,
        status: r.status,
        payer_name: r.payer_name,
        payer_email: r.payer_email,
        processor_ref: r.processor_ref,
        created_at: r.created_at,
      };
    });
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
    const [{ data: txRows, error: txError }, { data: viewRows, error: viewError }, { data: pages, error: pagesError }] =
      await Promise.all([
        supabaseAdmin.from("transactions").select("id,page_id,status,amount,created_at"),
        supabaseAdmin.from("page_views").select("id,page_id"),
        supabaseAdmin.from("payment_pages").select("id,title,slug"),
      ]);
    if (txError) throw txError;
    if (viewError) throw viewError;
    if (pagesError) throw pagesError;

    const tx = txRows || [];
    const views = viewRows || [];
    const pageRows = pages || [];
    const successfulTx = tx.filter((t) => t.status === "success");
    const totalViews = views.length;
    const totalTx = tx.length;

    const nowMs = Date.now();
    const trendMap = new Map();
    for (const row of tx) {
      if (!row.created_at) continue;
      if (new Date(row.created_at).getTime() < nowMs - 14 * 24 * 60 * 60 * 1000) continue;
      const day = String(row.created_at).slice(0, 10);
      const current = trendMap.get(day) || { day, transactionCount: 0, revenue: 0 };
      current.transactionCount += 1;
      if (row.status === "success") current.revenue += Number(row.amount || 0);
      trendMap.set(day, current);
    }

    const pagePerformance = pageRows
      .map((p) => {
        const txForPage = tx.filter((t) => t.page_id === p.id);
        return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          viewCount: views.filter((v) => v.page_id === p.id).length,
          transactionCount: txForPage.length,
          successCount: txForPage.filter((t) => t.status === "success").length,
          revenue: txForPage
            .filter((t) => t.status === "success")
            .reduce((sum, t) => sum + Number(t.amount || 0), 0),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return res.json({
      overview: {
        totalPages: pageRows.length,
        totalViews,
        totalTransactions: totalTx,
        successfulTransactions: successfulTx.length,
        failedTransactions: tx.filter((t) => t.status === "failed").length,
        pendingTransactions: tx.filter((t) => t.status === "pending").length,
        revenue: successfulTx.reduce((sum, t) => sum + Number(t.amount || 0), 0),
      },
      funnel: {
        viewed: totalViews,
        checkoutStarted: totalTx,
        successful: successfulTx.length,
        viewToCheckoutRate: totalViews ? totalTx / totalViews : 0,
        checkoutToSuccessRate: totalTx ? successfulTx.length / totalTx : 0,
      },
      trend: Array.from(trendMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
      pagePerformance,
    });
  } catch (err) {
    next(err);
  }
});
