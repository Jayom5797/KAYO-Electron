# ═══════════════════════════════════════════════════════════════════════════════
# KAYO AWS Deployment Script
# Deploys full infrastructure: ECR repos, Docker images, CloudFormation stack
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$REGION = "us-east-1"
$ACCOUNT_ID = "700640308663"
$STACK_NAME = "kayo-platform"

Write-Host "`n═══ KAYO AWS Deployment ═══" -ForegroundColor Red
Write-Host "Account: $ACCOUNT_ID | Region: $REGION`n"

# ── Step 1: Create ECR Repositories ───────────────────────────────────────────
Write-Host "[1/5] Creating ECR repositories..." -ForegroundColor Cyan

$repos = @("kayo-control-plane", "kayo-assessment-engine", "kayo-frontend")
foreach ($repo in $repos) {
    $exists = aws ecr describe-repositories --repository-names $repo --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) {
        aws ecr create-repository --repository-name $repo --region $REGION --image-scanning-configuration scanOnPush=true | Out-Null
        Write-Host "  Created: $repo" -ForegroundColor Green
    } else {
        Write-Host "  Exists: $repo" -ForegroundColor Yellow
    }
}

# ── Step 2: Docker Login to ECR ───────────────────────────────────────────────
Write-Host "`n[2/5] Logging into ECR..." -ForegroundColor Cyan
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# ── Step 3: Build & Push Images ───────────────────────────────────────────────
Write-Host "`n[3/5] Building and pushing Docker images..." -ForegroundColor Cyan

$ECR_BASE = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# Control Plane
Write-Host "  Building control-plane..." -ForegroundColor White
docker build -t kayo-control-plane:latest "../../services/control-plane"
docker tag kayo-control-plane:latest "$ECR_BASE/kayo-control-plane:latest"
docker push "$ECR_BASE/kayo-control-plane:latest"
Write-Host "  ✓ control-plane pushed" -ForegroundColor Green

# Assessment Engine
Write-Host "  Building assessment-engine..." -ForegroundColor White
docker build -t kayo-assessment-engine:latest "../../services/assessment-engine"
docker tag kayo-assessment-engine:latest "$ECR_BASE/kayo-assessment-engine:latest"
docker push "$ECR_BASE/kayo-assessment-engine:latest"
Write-Host "  ✓ assessment-engine pushed" -ForegroundColor Green

# Frontend
Write-Host "  Building frontend..." -ForegroundColor White
docker build -t kayo-frontend:latest "../../apps/web"
docker tag kayo-frontend:latest "$ECR_BASE/kayo-frontend:latest"
docker push "$ECR_BASE/kayo-frontend:latest"
Write-Host "  ✓ frontend pushed" -ForegroundColor Green

# ── Step 4: Deploy CloudFormation ─────────────────────────────────────────────
Write-Host "`n[4/5] Deploying CloudFormation stack..." -ForegroundColor Cyan

$stackExists = aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Updating existing stack..." -ForegroundColor Yellow
    aws cloudformation update-stack `
        --stack-name $STACK_NAME `
        --template-body file://cloudformation.yaml `
        --capabilities CAPABILITY_NAMED_IAM `
        --region $REGION 2>&1 | Out-Null
} else {
    Write-Host "  Creating new stack..." -ForegroundColor White
    aws cloudformation create-stack `
        --stack-name $STACK_NAME `
        --template-body file://cloudformation.yaml `
        --capabilities CAPABILITY_NAMED_IAM `
        --region $REGION
}

Write-Host "  Waiting for stack to complete (this takes 5-10 minutes)..." -ForegroundColor Yellow
aws cloudformation wait stack-create-complete --stack-name $STACK_NAME --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) {
    aws cloudformation wait stack-update-complete --stack-name $STACK_NAME --region $REGION 2>&1
}

# ── Step 5: Get Outputs ───────────────────────────────────────────────────────
Write-Host "`n[5/5] Getting deployment info..." -ForegroundColor Cyan

$outputs = aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query "Stacks[0].Outputs" --output json | ConvertFrom-Json

Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Red
Write-Host "  KAYO DEPLOYED SUCCESSFULLY" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Red

foreach ($output in $outputs) {
    Write-Host "  $($output.Description): $($output.OutputValue)" -ForegroundColor White
}

Write-Host "`n  Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open the ALBURL in your browser" -ForegroundColor White
Write-Host "  2. Sign up with your email" -ForegroundColor White
Write-Host "  3. Start scanning!" -ForegroundColor White
Write-Host ""
