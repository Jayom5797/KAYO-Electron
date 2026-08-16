.PHONY: help dev-up dev-down dev-setup test clean run-control-plane run-detection-engine

help:
	@echo "KAYO Development Commands"
	@echo "========================="
	@echo "make dev-up              - Start all development services"
	@echo "make dev-down            - Stop all development services"
	@echo "make dev-setup           - Initialize development environment"
	@echo "make run-control-plane   - Run control plane API server"
	@echo "make run-detection-engine - Run detection engine"
	@echo "make test                - Run all tests"
	@echo "make clean               - Clean up generated files"

dev-up:
	docker-compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@echo "Development environment ready!"
	@echo "PostgreSQL: localhost:5432"
	@echo "Redis: localhost:6379"
	@echo "Kafka: localhost:9092"
	@echo "ClickHouse: localhost:8123"
	@echo "Neo4j: http://localhost:7474"

dev-down:
	docker-compose down

dev-setup: dev-up
	@echo "Running database migrations..."
	cd services/control-plane && alembic upgrade head
	@echo "Creating ClickHouse schema..."
	docker exec kayo-clickhouse clickhouse-client --query "CREATE DATABASE IF NOT EXISTS kayo_events"
	@echo "Setup complete!"

test:
	@echo "Running control-plane tests..."
	cd services/control-plane && pytest tests/ -v
	@echo "Running graph-engine tests..."
	cd services/graph-engine && pytest tests/ -v

run-control-plane:
	@echo "Starting Control Plane API..."
	cd services/control-plane && uvicorn main:app --reload --host 0.0.0.0 --port 8000

run-detection-engine:
	@echo "Starting Detection Engine..."
	cd services/detection-engine && python detection_engine.py

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name "node_modules" -exec rm -rf {} +
