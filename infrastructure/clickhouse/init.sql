-- KAYO Event Storage Schema for ClickHouse
-- This schema stores security telemetry events with high write throughput

CREATE DATABASE IF NOT EXISTS kayo_events;

USE kayo_events;

-- Main events table with columnar storage optimized for time-series queries
CREATE TABLE IF NOT EXISTS events (
    -- Core identifiers
    event_id UUID,
    tenant_id UUID,
    timestamp DateTime64(6),
    source_type LowCardinality(String),
    
    -- Event classification
    event_category LowCardinality(String),
    event_type LowCardinality(String),
    event_action String,
    event_outcome LowCardinality(String),
    
    -- User entity
    user_id Nullable(UUID),
    user_name Nullable(String),
    
    -- Process entity
    process_id Nullable(UUID),
    process_name Nullable(String),
    process_pid Nullable(UInt32),
    process_cmdline Nullable(String),
    process_parent_id Nullable(UUID),
    
    -- Host entity
    host_id Nullable(UUID),
    host_name Nullable(String),
    host_ip Nullable(IPv4),
    
    -- Container entity
    container_id Nullable(String),
    container_name Nullable(String),
    container_image Nullable(String),
    
    -- Network fields
    network_source_ip Nullable(IPv4),
    network_dest_ip Nullable(IPv4),
    network_dest_port Nullable(UInt16),
    network_protocol Nullable(String),
    
    -- File fields
    file_path Nullable(String),
    file_hash Nullable(String),
    
    -- Deployment context
    deployment_name Nullable(String),
    namespace Nullable(String),
    
    -- Security metadata
    risk_score UInt8 DEFAULT 0,
    tags Array(String) DEFAULT [],
    
    -- Raw event data (JSON)
    raw String
    
) ENGINE = MergeTree()
PARTITION BY (tenant_id, toYYYYMM(timestamp))
ORDER BY (tenant_id, timestamp, event_id)
SETTINGS index_granularity = 8192;

-- Indexes for common query patterns
-- Bloom filter for UUID lookups (space-efficient probabilistic index)
ALTER TABLE events ADD INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE events ADD INDEX idx_process_id process_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE events ADD INDEX idx_host_id host_id TYPE bloom_filter GRANULARITY 1;

-- Bloom filter for string searches (compatible with Nullable(String))
ALTER TABLE events ADD INDEX idx_process_name process_name TYPE bloom_filter GRANULARITY 1;
ALTER TABLE events ADD INDEX idx_container_id container_id TYPE bloom_filter GRANULARITY 1;

-- Materialized view for event counts by tenant (pre-aggregated for dashboards)
-- Time complexity: O(1) for count queries instead of O(n)
CREATE MATERIALIZED VIEW IF NOT EXISTS events_by_tenant_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, date, source_type)
AS SELECT
    tenant_id,
    toDate(timestamp) as date,
    source_type,
    count() as event_count
FROM events
GROUP BY tenant_id, date, source_type;

-- Materialized view for high-risk events (security dashboard)
CREATE MATERIALIZED VIEW IF NOT EXISTS high_risk_events_mv
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, timestamp)
AS SELECT
    event_id,
    tenant_id,
    timestamp,
    event_category,
    event_action,
    risk_score,
    user_name,
    host_name,
    process_name
FROM events
WHERE risk_score >= 70;

-- Table for tenant usage tracking (billing and quota enforcement)
CREATE TABLE IF NOT EXISTS tenant_usage_daily (
    tenant_id UUID,
    date Date,
    events_ingested UInt64,
    storage_bytes UInt64,
    graph_queries UInt32,
    ai_tokens UInt64
) ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (tenant_id, date);

-- Grant permissions (if using ClickHouse users)
-- GRANT SELECT, INSERT ON kayo_events.* TO kayo;
