CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, org_id INTEGER REFERENCES orgs(id), name TEXT);
CREATE INDEX users_email ON users(email);
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), total INTEGER, created_at TEXT);
CREATE INDEX orders_created ON orders(created_at);
