CREATE TABLE IF NOT EXISTS profiles AS
SELECT user_id,region,device,channel,started_at AS first_seen FROM (
 SELECT *,ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY started_at,channel,device,region,visit_id) AS rn FROM visits
) ranked WHERE rn=1;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id ON profiles(user_id);
CREATE TABLE IF NOT EXISTS purchase_facts AS
SELECT *,ROW_NUMBER() OVER(PARTITION BY user_id ORDER BY purchased_at,purchase_id) AS purchase_index FROM purchases;
CREATE INDEX IF NOT EXISTS purchase_facts_user ON purchase_facts(user_id,purchased_at);
