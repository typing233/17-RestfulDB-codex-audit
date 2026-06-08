-- Migration: Example views for testing view introspection
-- Up

CREATE OR REPLACE VIEW product_summary AS
SELECT
  p.id,
  p.name,
  p.price,
  p.stock,
  c.name AS category_name,
  COALESCE(AVG(r.rating), 0) AS avg_rating,
  COUNT(r.id) AS review_count
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN reviews r ON r.product_id = p.id
GROUP BY p.id, p.name, p.price, p.stock, c.name;

CREATE MATERIALIZED VIEW IF NOT EXISTS order_stats AS
SELECT
  u.id AS user_id,
  u.name AS user_name,
  COUNT(o.id) AS total_orders,
  COALESCE(SUM(o.total), 0) AS total_spent,
  MAX(o.created_at) AS last_order_at
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_stats_user_id ON order_stats(user_id);

GRANT SELECT ON product_summary TO anon, authenticated, admin;
GRANT SELECT ON order_stats TO authenticated, admin;
