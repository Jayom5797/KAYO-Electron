#!/bin/bash
set -e

echo "🚀 Setting up KAYO development environment..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed."; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "❌ Docker Compose is required but not installed."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3 is required but not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed."; exit 1; }

echo "✅ Prerequisites check passed"

# Start infrastructure services
echo "📦 Starting infrastructure services..."
docker-compose up -d postgres redis kafka neo4j clickhouse

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Install backend dependencies
echo "📚 Installing backend dependencies..."
cd services/control-plane
python3 -m pip install -r requirements.txt

# Run database migrations
echo "🗄️  Running database migrations..."
alembic upgrade head

cd ../..

# Install frontend dependencies
echo "📚 Installing frontend dependencies..."
cd frontend
npm install

cd ..

echo "✅ Development environment setup complete!"
echo ""
echo "To start the services:"
echo "  Backend:  cd services/control-plane && uvicorn main:app --reload"
echo "  Frontend: cd frontend && npm run dev"
echo ""
echo "Access points:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
