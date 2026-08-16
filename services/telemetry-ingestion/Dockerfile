FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 kayo && chown -R kayo:kayo /app
USER kayo

# Run consumer
CMD ["python", "clickhouse_consumer.py"]
