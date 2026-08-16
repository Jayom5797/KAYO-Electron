"""Check CloudFormation stack status and events."""
import subprocess, json, sys

stack_name = sys.argv[1] if len(sys.argv) > 1 else "kayo-project-test-safe-a"

result = subprocess.run(
    ["aws", "cloudformation", "describe-stack-events", "--stack-name", stack_name,
     "--output", "json", "--region", "us-east-1"],
    capture_output=True, text=True, timeout=15
)

if result.returncode != 0:
    print(f"ERROR: {result.stderr}")
    sys.exit(1)

data = json.loads(result.stdout)
for e in data["StackEvents"]:
    status = e.get("ResourceStatus", "")
    if "FAILED" in status:
        reason = e.get("ResourceStatusReason", "")
        resource = e.get("LogicalResourceId", "")
        rtype = e.get("ResourceType", "")
        print(f"FAILED: {resource} ({rtype})")
        print(f"  Reason: {reason[:300]}")
        print()
