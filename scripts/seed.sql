-- RestfulDB Demo Schema with RLS
-- Run this against your PostgreSQL to test the service

-- Roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin') THEN
    CREATE ROLE admin NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, admin;
GRANT anon TO postgres;
GRANT authenticated TO postgres;
GRANT admin TO postgres;

-- Tables
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL,
  stock INTEGER DEFAULT 0,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  total NUMERIC(10, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  version INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO admin;

-- Anon: SELECT on all tables but restricted columns on users
GRANT SELECT ON categories, products, orders, order_items, reviews TO anon;
GRANT SELECT (id, name, role, created_at, version) ON users TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY users_select ON users FOR SELECT USING (true);
CREATE POLICY users_update ON users FOR UPDATE USING (
  current_setting('request.jwt.claims', true)::json->>'sub' = id::text
  OR current_user = 'admin'
);

CREATE POLICY orders_select ON orders FOR SELECT USING (
  user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
  OR current_user = 'admin'
);
CREATE POLICY orders_insert ON orders FOR INSERT WITH CHECK (
  user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
  OR current_user = 'admin'
);
CREATE POLICY orders_update ON orders FOR UPDATE USING (
  user_id::text = current_setting('request.jwt.claims', true)::json->>'sub'
  OR current_user = 'admin'
);
CREATE POLICY orders_delete ON orders FOR DELETE USING (
  current_user = 'admin'
);

CREATE POLICY order_items_all ON order_items FOR ALL USING (true);
CREATE POLICY reviews_all ON reviews FOR ALL USING (true);

-- Seed data
INSERT INTO users (email, name, role) VALUES
  ('alice@example.com', 'Alice', 'admin'),
  ('bob@example.com', 'Bob', 'user'),
  ('charlie@example.com', 'Charlie', 'user')
ON CONFLICT DO NOTHING;

INSERT INTO categories (name, description) VALUES
  ('Electronics', 'Electronic devices and gadgets'),
  ('Books', 'Physical and digital books'),
  ('Clothing', 'Apparel and accessories')
ON CONFLICT DO NOTHING;

INSERT INTO products (name, description, price, stock, category_id) VALUES
  ('Laptop', 'High-performance laptop', 999.99, 50, 1),
  ('Headphones', 'Noise-canceling headphones', 149.99, 200, 1),
  ('TypeScript Handbook', 'Complete guide to TypeScript', 39.99, 1000, 2),
  ('T-Shirt', 'Comfortable cotton t-shirt', 19.99, 500, 3)
ON CONFLICT DO NOTHING;

INSERT INTO orders (user_id, status, total) VALUES
  (1, 'completed', 1149.98),
  (2, 'pending', 39.99),
  (2, 'shipped', 169.98)
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 999.99),
  (1, 2, 1, 149.99),
  (2, 3, 1, 39.99),
  (3, 2, 1, 149.99),
  (3, 4, 1, 19.99)
ON CONFLICT DO NOTHING;

INSERT INTO reviews (user_id, product_id, rating, comment) VALUES
  (1, 1, 5, 'Excellent laptop, highly recommended!'),
  (2, 3, 4, 'Great book for learning TypeScript'),
  (2, 2, 3, 'Good headphones but battery could be better')
ON CONFLICT DO NOTHING;
