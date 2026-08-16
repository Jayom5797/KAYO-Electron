const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// INTENTIONAL: Hardcoded fake credentials for security gate testing
// These are NOT real credentials — they exist solely to trigger secret detection
const AWS_SECRET_KEY = "AKIAIOSFODNN7EXAMPLEFAKEKEY1234567890AB";
const DB_PASSWORD = "super_secret_password_do_not_use";
const API_TOKEN = "ghp_FAKE00000000000000000000000000000000";

app.get('/', (req, res) => {
  // INTENTIONAL: Information disclosure
  res.json({
    status: 'ok',
    debug: true,
    internal_config: {
      database: `postgresql://admin:${DB_PASSWORD}@internal-db:5432/prod`,
      environment: 'production',
    }
  });
});

// INTENTIONAL: SQL injection vulnerable endpoint
app.get('/users', (req, res) => {
  const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;
  res.json({ query_executed: query });
});

app.listen(PORT, () => {
  console.log(`Insecure test app on port ${PORT}`);
});
