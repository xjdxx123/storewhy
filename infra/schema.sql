CREATE TABLE IF NOT EXISTS visits (
 visit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id TEXT NOT NULL, region TEXT NOT NULL, device TEXT NOT NULL, channel TEXT NOT NULL,
 started_at TIMESTAMP NOT NULL, ended_at TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
 purchase_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id TEXT NOT NULL, purchased_at TIMESTAMP NOT NULL, amount NUMERIC(28,8) NOT NULL
);
CREATE TABLE IF NOT EXISTS costs (
 cost_date DATE NOT NULL, channel TEXT NOT NULL, amount NUMERIC(28,8) NOT NULL,
 PRIMARY KEY(cost_date,channel)
);
CREATE INDEX IF NOT EXISTS visits_user_time ON visits(user_id,started_at);
CREATE INDEX IF NOT EXISTS purchases_user_time ON purchases(user_id,purchased_at);
