import psycopg2
conn = psycopg2.connect('postgresql://kayo:kayo_e2e_password@localhost:5433/kayo_e2e')
cur = conn.cursor()
cur.execute("UPDATE incidents SET remediation_steps = '[]'::jsonb, notes = '[]'::jsonb WHERE remediation_steps IS NULL OR notes IS NULL")
conn.commit()
cur.execute("SELECT incident_id, severity, status, attack_pattern, mitre_technique FROM incidents")
for row in cur.fetchall():
    print(f"Incident: {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]}")
conn.close()
print("Fixed!")
