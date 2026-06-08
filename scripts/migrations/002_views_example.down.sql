-- Migration: Drop example views
-- Down

DROP MATERIALIZED VIEW IF EXISTS order_stats;
DROP VIEW IF EXISTS product_summary;
